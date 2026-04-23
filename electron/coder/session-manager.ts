/**
 * CoderSessionManager
 *
 * Per-project Coder session management. Replaces the previous module-global
 * `SerialQueue` in `coder-runner.ts` with a `Map<projectPath, CoderSession>`.
 * Each session owns:
 *  - an independent SerialQueue (same-project tasks stay serial)
 *  - current ChildProcess reference (so we can cancel)
 *  - CoderBuffer (unified event stream with global `seq`)
 *  - running flag
 *
 * This module is also the **single source-of-truth for Coder-related
 * `agent:stream` events**: all producers (ipc/coder.ts, send-to-coder.ts,
 * auto-build.ts, self-heal.ts) MUST go through `emitEvent(projectPath, event)`,
 * never `webContents.send('agent:stream', ...)` directly. The manager
 * synchronously:
 *   1. writes the event into the session's CoderBuffer (assigns `seq`),
 *   2. broadcasts to the BrowserWindow with `seq` + `projectPath` merged in.
 *
 * Exception: the GD Agent itself (agent/gd-agent.ts, ipc/agent.ts) may run
 * before any project exists and therefore does NOT route through the manager.
 * Those call sites still carry `projectPath` (possibly `null`) in the payload
 * so the renderer can filter.
 */

import { ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import { SerialQueue } from './queue';
import {
  CoderBuffer,
  type BufferedEvent,
  type BufferedEventType,
  type CoderBufferSnapshot,
} from './coder-buffer';

export interface CoderSession {
  projectPath: string;
  queue: SerialQueue;
  /** Pending tasks not yet started (drop-on-cancel). */
  pendingCount: number;
  /** Currently running child process, if any. */
  currentChild: ChildProcess | null;
  /** Current in-flight batchId, if any. */
  currentBatchId: string | null;
  buffer: CoderBuffer;
  running: boolean;
}

export interface EmitEventInput {
  batchId: string | null;
  type: BufferedEventType;
  /**
   * Payload mirrors the existing `agent:stream` event body. `seq` /
   * `projectPath` / `batchId` will be merged onto payload automatically at
   * broadcast time — do NOT include them here (batchId is a top-level field).
   */
  payload: Record<string, unknown>;
}

type RunningChangedListener = (runningPaths: string[]) => void;

class CoderSessionManagerImpl {
  private sessions = new Map<string, CoderSession>();
  private globalSeq = 0;
  private batchCounter = 0;
  private runningListeners = new Set<RunningChangedListener>();

  /** Get or lazily create a session entry for a project. */
  getOrCreate(projectPath: string): CoderSession {
    let session = this.sessions.get(projectPath);
    if (!session) {
      session = {
        projectPath,
        queue: new SerialQueue(),
        pendingCount: 0,
        currentChild: null,
        currentBatchId: null,
        buffer: new CoderBuffer(),
        running: false,
      };
      this.sessions.set(projectPath, session);
    }
    return session;
  }

  getSession(projectPath: string): CoderSession | null {
    return this.sessions.get(projectPath) || null;
  }

  /**
   * Enqueue a task against the project's serial queue. The task receives the
   * owning session so it can register its child process via
   * `setCurrentChild()` for cancellation support.
   *
   * Running state transitions (running -> !running) are broadcast via
   * `coder:running-changed` so the home page can update badges.
   */
  enqueue<T>(
    projectPath: string,
    task: (session: CoderSession) => Promise<T>,
  ): Promise<T> {
    const session = this.getOrCreate(projectPath);
    session.pendingCount += 1;
    return session.queue.enqueue(async () => {
      session.pendingCount = Math.max(0, session.pendingCount - 1);
      const wasRunning = session.running;
      session.running = true;
      if (!wasRunning) this.fireRunningChanged();
      try {
        return await task(session);
      } finally {
        session.running = false;
        session.currentChild = null;
        session.currentBatchId = null;
        this.fireRunningChanged();
      }
    });
  }

  /**
   * Globally unique batchId generator. Replaces ad-hoc `coder_${Date.now()}`
   * in IPC handlers. Guarantees no collision even for same-ms concurrent
   * calls across different projects.
   */
  startBatch(projectPath: string): string {
    this.batchCounter += 1;
    const hash = hashProjectPath(projectPath);
    // Format: coder_<projectHash>_<globalMonotonicCounter>
    return `coder_${hash}_${this.batchCounter}`;
  }

  /**
   * Emit a Coder-related event. This is THE single source-of-truth entry
   * point for all `agent:stream` events originating from Coder-adjacent code
   * paths (coder send, send-to-coder tool, auto-build, self-heal).
   *
   * Guarantees:
   *  - Event is appended to the project's CoderBuffer with a fresh global seq.
   *  - Event is broadcast on `agent:stream` to every visible BrowserWindow,
   *    with `{ projectPath, seq, batchId }` merged onto the payload (plus
   *    `type` which maps back to the renderer's existing event shape).
   */
  emitEvent(projectPath: string, input: EmitEventInput): void {
    const session = this.getOrCreate(projectPath);
    this.globalSeq += 1;
    const evt: BufferedEvent = {
      seq: this.globalSeq,
      batchId: input.batchId,
      type: input.type,
      payload: input.payload,
      at: Date.now(),
    };
    session.buffer.append(evt);

    // Broadcast to all windows. Payload shape matches the renderer's
    // existing AgentStreamEvent (type + fields) plus `seq` and `projectPath`.
    const broadcastPayload = {
      ...input.payload,
      type: input.type === 'agent-message' ? 'text-delta' : input.type, // 'agent-message' maps back to existing 'text-delta' renderer handler
      batchId: input.batchId ?? undefined,
      seq: evt.seq,
      projectPath,
    };

    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('agent:stream', broadcastPayload);
      } catch {
        /* window may be destroyed */
      }
    }
  }

  /** Register a spawned child on the current session (for cancellation). */
  setCurrentChild(projectPath: string, child: ChildProcess | null, batchId: string | null): void {
    const session = this.getOrCreate(projectPath);
    session.currentChild = child;
    if (batchId !== null) session.currentBatchId = batchId;
  }

  /**
   * Register the in-flight batchId on the session without touching `currentChild`.
   *
   * Used by `coder:send` to register a batch BEFORE `runCoderAgent` spawns the
   * child process. This makes `coder:cancel`'s `currentBatch` branch able to
   * find the right batchId and emit the `__cancelled` status event even when
   * the cancel arrives during the launching phase (before the child exists).
   *
   * `enqueue`'s `finally` block still clears `currentBatchId` when the task
   * finishes, so no manual cleanup is needed.
   */
  setCurrentBatchId(projectPath: string, batchId: string | null): void {
    const session = this.getOrCreate(projectPath);
    session.currentBatchId = batchId;
  }

  /**
   * Cancel the project's in-flight Coder task + drop all pending tasks.
   * Uses SIGTERM -> 3s -> SIGKILL. Preserves the session and its buffer so
   * the UI can still show the transcript and `--resume` is possible later.
   */
  async cancel(projectPath: string): Promise<{ cancelled: boolean }> {
    const session = this.sessions.get(projectPath);
    if (!session) return { cancelled: false };

    // Drop pending tasks: wrap the queue's internals — SerialQueue doesn't
    // expose a drain method, so we replace its queue by re-constructing it.
    // Acceptable because SerialQueue is only consumed via enqueue().
    (session.queue as any).queue = [];
    session.pendingCount = 0;

    const child = session.currentChild;
    if (!child) return { cancelled: false };

    child.kill('SIGTERM');

    // Wait up to 3s for graceful exit, then SIGKILL.
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }

    session.currentChild = null;
    return { cancelled: true };
  }

  /**
   * Close a session entirely: cancel any in-flight work, clear the buffer,
   * and remove the session from the map. Called on project:close /
   * project:delete to avoid buffer leakage.
   */
  async closeSession(projectPath: string): Promise<void> {
    await this.cancel(projectPath);
    const session = this.sessions.get(projectPath);
    if (session) {
      session.buffer.clear();
      this.sessions.delete(projectPath);
    }
    this.fireRunningChanged();
  }

  getSnapshot(projectPath: string): CoderBufferSnapshot | null {
    const session = this.sessions.get(projectPath);
    if (!session) return null;
    return session.buffer.snapshot();
  }

  listRunning(): string[] {
    const out: string[] = [];
    for (const [path, s] of this.sessions) {
      if (s.running) out.push(path);
    }
    return out;
  }

  onRunningChanged(fn: RunningChangedListener): () => void {
    this.runningListeners.add(fn);
    return () => this.runningListeners.delete(fn);
  }

  /**
   * Kill every spawned child (app exit / window-all-closed hook).
   *
   * Beyond just SIGKILLing children, we also **write a terminal status event
   * into each session's CoderBuffer** for any batch that was in-flight.
   * Rationale: on macOS closing the window does NOT quit the app
   * (window-all-closed skips `app.quit()` per Apple HIG). The main process
   * stays alive together with every in-memory `CoderSession` and its
   * `CoderBuffer`. When the user re-opens the window later, `coder:subscribe`
   * replays those buffers into the freshly-mounted ChatPanel. Without the
   * terminal marker below the renderer would render an in-flight batch
   * spinner forever, because:
   *   1. The child was SIGKILL'd so coder-runner never got to emit its own
   *      `done`/`failed` status.
   *   2. The outer IPC handler's `await runCoderAgent(...)` only resolves
   *      after `child.on('close')` fires, which on a hard kill races the
   *      window teardown.
   * Emitting an explicit `__cancelled + __done + __terminal` marker here
   * short-circuits all three stale-spinner paths (live renderer handler,
   * buffer snapshot aggregator, and hydrate replay).
   */
  killAll(): void {
    for (const session of this.sessions.values()) {
      const batchId = session.currentBatchId;
      if (batchId) {
        // Directly append to buffer — do NOT route through emitEvent() because
        // windows are about to be torn down / already gone; the broadcast
        // would be a no-op at best and throw at worst.
        this.globalSeq += 1;
        session.buffer.append({
          seq: this.globalSeq,
          batchId,
          type: 'status',
          payload: {
            text: 'interrupted',
            __done: true,
            __cancelled: true,
            __terminal: true,
          },
          at: Date.now(),
        });
      }
      if (session.currentChild) {
        try { session.currentChild.kill('SIGKILL'); } catch {}
      }
      // Clear transient state — the Promise chain inside `enqueue` may or may
      // not run its `finally` block depending on how fast the process dies,
      // so we eagerly null these here for correctness on the replay path.
      session.currentChild = null;
      session.currentBatchId = null;
      session.running = false;
    }
    this.fireRunningChanged();
  }

  private fireRunningChanged(): void {
    const paths = this.listRunning();
    for (const fn of this.runningListeners) {
      try { fn(paths); } catch {}
    }
    // Also broadcast to renderer windows.
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('coder:running-changed', { runningPaths: paths });
      } catch {}
    }
  }
}

/**
 * Simple stable hash of a project path (30-bit) rendered as base36.
 * Just to keep batchIds short; not used for security.
 */
function hashProjectPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = (h * 31 + p.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** Module-level singleton. */
export const coderSessionManager = new CoderSessionManagerImpl();
export type CoderSessionManager = CoderSessionManagerImpl;
