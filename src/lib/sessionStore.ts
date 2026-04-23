'use client';

/**
 * SessionStore — per-project client-side view of Coder session state.
 *
 * Responsibilities:
 *  1. Hold `ProjectSessionState` keyed by `projectPath`, including the list
 *     of coder batches, transient GD streaming text, active (non-coder) tool
 *     calls, and the per-project running flag.
 *  2. Ingest `agent:stream` events with **seq-based deduplication** so the
 *     subscribe snapshot (`coder:subscribe`) and the live tail (`onAgentStream`)
 *     can overlap safely on reconnect.
 *  3. Expose a publish-subscribe API so components can selectively subscribe
 *     to only their current project (avoids re-rendering every panel when
 *     another background session emits output).
 *
 * Why not Redux/Zustand? The set of mutations is narrow and all keyed by
 * `projectPath`. Keeping this in one file with a simple emitter makes the
 * control-flow trivial to audit during debugging and requires no bundler
 * changes.
 */

import type { AgentStreamEvent, BufferedCoderEvent, CoderBufferSnapshot } from '../../electron/preload';

/** What the ChatPanel cares about for a single project. */
export interface ProjectSessionState {
  /** Last applied event seq (Coder events only). Used for dedupe. */
  lastAppliedSeq: number;
  /** Coder batches keyed by batchId, in insertion order. */
  batches: CoderBatch[];
  /** Currently streaming GD Agent text (cleared on `done`). */
  streamingText: string;
  /** Non-coder tool calls in flight (create_project, update_gdd, etc.). */
  activeToolCalls: Map<string, { name: string; status: 'running' | 'done' }>;
  /** True if a coder batch in this session is still running. */
  running: boolean;
  /** Whether we have hydrated from backend (after first `coderSubscribe`). */
  hydrated: boolean;
}

export interface CoderBatch {
  batchId: string;
  status: string | null;
  output: string[];
  started: boolean;
  done: boolean;
  cancelled: boolean;
}

const OUTPUT_CAP_PER_BATCH = 200;

function freshState(): ProjectSessionState {
  return {
    lastAppliedSeq: 0,
    batches: [],
    streamingText: '',
    activeToolCalls: new Map(),
    running: false,
    hydrated: false,
  };
}

type Listener = () => void;

class SessionStoreImpl {
  private states = new Map<string, ProjectSessionState>();
  /** Per-project listener sets. */
  private listeners = new Map<string, Set<Listener>>();

  getSnapshot(projectPath: string): ProjectSessionState {
    let s = this.states.get(projectPath);
    if (!s) {
      s = freshState();
      this.states.set(projectPath, s);
    }
    return s;
  }

  /**
   * Subscribe to mutations on a specific project. Returns an unsubscribe
   * function. Components should call `useSyncExternalStore` with these.
   */
  subscribe(projectPath: string, fn: Listener): () => void {
    let set = this.listeners.get(projectPath);
    if (!set) {
      set = new Set();
      this.listeners.set(projectPath, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  private notify(projectPath: string): void {
    const set = this.listeners.get(projectPath);
    if (!set) return;
    for (const fn of set) {
      try {
        fn();
      } catch (err) {
        // Listener errors should not break the event stream; log and continue.
        console.error('[SessionStore] listener error:', err);
      }
    }
  }

  /**
   * Reset per-turn transient state at the start of a new user message.
   *
   * Only the current turn's streaming-text accumulator and the map of
   * in-flight tool calls are cleared. All batches (both in-flight and
   * already-completed) are preserved so the ChatPanel keeps rendering the
   * full multi-turn transcript, consistent with how `hydrateFromBackend`
   * rebuilds state from the backend's CoderBuffer on page reload. Previously
   * this method filtered out finished batches, which silently dropped every
   * successful history card as soon as the user sent the next message — a
   * UX regression relative to the hydrate path.
   */
  beginUserTurn(projectPath: string): void {
    const s = this.getSnapshot(projectPath);
    s.streamingText = '';
    s.activeToolCalls = new Map();
    // New reference identity for React.
    this.states.set(projectPath, { ...s });
    this.notify(projectPath);
  }

  /**
   * Hydrate this project's state from the backend's CoderBuffer snapshot.
   *
   * **Call sequence contract**: callers MUST register their `onAgentStream`
   * listener BEFORE awaiting `coderSubscribe` — see ChatPanel. This ordering
   * ensures events emitted between subscribe-call and snapshot-return are
   * captured live and then deduped against the snapshot via `lastAppliedSeq`.
   */
  async hydrateFromBackend(projectPath: string): Promise<void> {
    const api = (typeof window !== 'undefined' ? window.miniplay : undefined);
    if (!api?.coderSubscribe) return;
    let snap: CoderBufferSnapshot;
    try {
      snap = await api.coderSubscribe({ projectPath });
    } catch (err) {
      console.error('[SessionStore] coderSubscribe failed:', err);
      return;
    }

    const s = this.getSnapshot(projectPath);
    // If live events have already advanced lastAppliedSeq past the snapshot,
    // we only need to backfill batch structure from the snapshot without
    // re-applying events (they would be no-ops anyway). We take the max of
    // the two as the new watermark.
    for (const evt of snap.events) {
      if (evt.seq <= s.lastAppliedSeq) continue;
      this.applyBufferedEvent(s, evt);
      s.lastAppliedSeq = evt.seq;
    }

    // Seed running flag from snapshot batches: any non-done batch ⇒ running.
    s.running = snap.batches.some(b => !b.done);

    // ---------------------------------------------------------------
    // Orphan-batch reconciliation.
    //
    // If the backend reports that this project is NOT currently running a
    // Coder task, any batch we still see as `!done` is stale (typically a
    // batch that was in-flight when the user closed the macOS window — the
    // child was SIGKILLed but a terminal status event may have been lost
    // between producers/consumers). Mark them done+cancelled so the UI
    // exits the spinner state. This complements the producer-side fix in
    // `CoderSessionManagerImpl.killAll` and is deliberately belt-and-braces.
    // ---------------------------------------------------------------
    try {
      const list = await api.coderRunningList?.();
      const runningPaths = list?.runningPaths ?? [];
      const isRunning = runningPaths.includes(projectPath);
      if (!isRunning) {
        let mutated = false;
        for (const b of s.batches) {
          if (!b.done) {
            b.done = true;
            b.cancelled = true;
            if (!b.status || /^(launching|agent:|starting)/i.test(b.status)) {
              b.status = 'interrupted';
            }
            mutated = true;
          }
        }
        if (mutated) s.running = false;
      }
    } catch {
      // Non-fatal: if the running-list query fails, leave batches as the
      // buffer reports them. The live stream will still correct on the next
      // real event.
    }

    s.hydrated = true;
    this.states.set(projectPath, { ...s });
    this.notify(projectPath);
  }

  /**
   * Ingest a live `agent:stream` event. Performs seq-based dedupe for
   * Coder events (those carry a `seq`). GD-Agent events (no `seq`) are
   * always applied.
   */
  ingestEvent(projectPath: string, event: AgentStreamEvent): void {
    const s = this.getSnapshot(projectPath);

    // Dedupe by seq for Coder events.
    if (typeof event.seq === 'number') {
      if (event.seq <= s.lastAppliedSeq) return;
      s.lastAppliedSeq = event.seq;
    }

    this.applyLiveEvent(s, event);
    this.states.set(projectPath, { ...s });
    this.notify(projectPath);
  }

  /**
   * Cancel the running coder task for a project. Optimistically marks
   * currently-running batches as cancelled/done so the UI hides the Stop
   * button before the IPC round-trip completes.
   */
  async cancel(projectPath: string): Promise<void> {
    const api = typeof window !== 'undefined' ? window.miniplay : undefined;
    if (!api?.coderCancel) return;

    const s = this.getSnapshot(projectPath);
    s.batches = s.batches.map(b => (!b.done ? { ...b, cancelled: true } : b));
    this.states.set(projectPath, { ...s });
    this.notify(projectPath);

    try {
      await api.coderCancel({ projectPath });
    } catch (err) {
      console.error('[SessionStore] coderCancel failed:', err);
    }
  }

  /**
   * Drop all in-memory state for a project — called when the project is
   * fully closed/deleted so the buffer doesn't leak across sessions.
   */
  forgetProject(projectPath: string): void {
    this.states.delete(projectPath);
    this.listeners.delete(projectPath);
  }

  // ------------------- Internals -------------------

  /** Apply a backend-buffer event (shape = `BufferedCoderEvent`). */
  private applyBufferedEvent(s: ProjectSessionState, evt: BufferedCoderEvent): void {
    // Backend `type` values map 1:1 to the live event types below except
    // `agent-message` which we render like `text-delta`.
    const payload = evt.payload as Record<string, unknown>;
    const batchId = evt.batchId;
    switch (evt.type) {
      case 'tool-call':
        if (batchId && payload.toolName === 'send_to_coder') {
          ensureBatch(s, batchId);
        } else if (typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
          s.activeToolCalls.set(payload.toolCallId, {
            name: payload.toolName,
            status: 'running',
          });
        }
        break;
      case 'status':
        if (batchId) {
          const b = ensureBatch(s, batchId);
          if (typeof payload.text === 'string') b.status = payload.text;
          b.started = true;
          if (payload.__cancelled === true) b.cancelled = true;
          // Accept both `__done` (emitted by ipc/coder.ts and
          // session-manager.killAll) and `__terminal` (emitted by
          // process/self-heal.ts). The two markers are semantically
          // equivalent to the renderer — any of them means "this batch is
          // finished, stop rendering the spinner". We also treat the known
          // terminal status words as done so a hydrate-only replay where
          // producers forgot the marker still exits the spinner state.
          const statusText =
            typeof payload.text === 'string' ? payload.text.toLowerCase() : '';
          if (
            payload.__done === true ||
            payload.__terminal === true ||
            ['done', 'failed', 'cancelled', 'interrupted'].includes(statusText)
          ) {
            b.done = true;
          }
        }
        break;
      case 'output':
        if (batchId && typeof payload.text === 'string') {
          const b = ensureBatch(s, batchId);
          b.output = capOutput([...b.output, payload.text]);
          b.started = true;
        }
        break;
      case 'tool-result':
        if (batchId && typeof payload.toolCallId === 'string' && payload.toolCallId === batchId) {
          const b = ensureBatch(s, batchId);
          b.done = true;
        } else if (typeof payload.toolCallId === 'string') {
          const existing = s.activeToolCalls.get(payload.toolCallId);
          if (existing) s.activeToolCalls.set(payload.toolCallId, { ...existing, status: 'done' });
        }
        break;
      case 'agent-message':
        if (typeof payload.text === 'string') {
          s.streamingText += payload.text;
        }
        break;
    }
    s.running = s.batches.some(b => !b.done);
  }

  /** Apply a live `agent:stream` event (existing renderer shape). */
  private applyLiveEvent(s: ProjectSessionState, event: AgentStreamEvent): void {
    const { type, batchId } = event;

    if (type === 'text-delta' && event.text) {
      s.streamingText += event.text;
      return;
    }
    if (type === 'tool-call' && event.toolCallId && event.toolName) {
      if (event.toolName === 'send_to_coder' && batchId) {
        ensureBatch(s, batchId);
      } else if (event.toolName !== 'send_to_coder') {
        s.activeToolCalls.set(event.toolCallId, { name: event.toolName, status: 'running' });
      }
      return;
    }
    if ((type === 'coder-status' || type === 'status') && typeof event.text === 'string') {
      if (batchId) {
        const b = ensureBatch(s, batchId);
        b.status = event.text;
        b.started = true;
        // Terminal flags carried via payload (see session-manager.emitEvent).
        // Accept both `__done` and `__terminal` (producers are inconsistent);
        // also treat the known terminal status words as done for robustness.
        const payload = event as unknown as Record<string, unknown>;
        if (payload.__cancelled === true) b.cancelled = true;
        const statusText = event.text.toLowerCase();
        if (
          payload.__done === true ||
          payload.__terminal === true ||
          ['done', 'failed', 'cancelled', 'interrupted'].includes(statusText)
        ) {
          b.done = true;
        }
      }
      return;
    }
    if ((type === 'coder-output' || type === 'output') && typeof event.text === 'string') {
      if (batchId) {
        const b = ensureBatch(s, batchId);
        b.output = capOutput([...b.output, event.text]);
        b.started = true;
      }
      return;
    }
    if (type === 'tool-result' && event.toolCallId) {
      if (batchId && event.toolCallId === batchId) {
        const b = ensureBatch(s, batchId);
        b.done = true;
      } else {
        const existing = s.activeToolCalls.get(event.toolCallId);
        if (existing) s.activeToolCalls.set(event.toolCallId, { ...existing, status: 'done' });
      }
      return;
    }
    if (type === 'done') {
      if (batchId) {
        const b = s.batches.find(x => x.batchId === batchId);
        if (b) b.done = true;
      } else {
        // GD Agent turn completed — drop streaming text and clear activeToolCalls
        s.streamingText = '';
        // Mark all activeToolCalls as done so they render as completed.
        for (const [id, tc] of s.activeToolCalls) {
          s.activeToolCalls.set(id, { ...tc, status: 'done' });
        }
      }
      return;
    }
    if (type === 'error') {
      s.streamingText = '';
      return;
    }
    // `gdd-updated` is not a state-mutating event for the session store —
    // it's handled by ChatPanel directly via an effect on the raw listener.
    // Recompute running.
    s.running = s.batches.some(b => !b.done);
  }
}

function ensureBatch(s: ProjectSessionState, batchId: string): CoderBatch {
  let b = s.batches.find(x => x.batchId === batchId);
  if (!b) {
    b = {
      batchId,
      status: null,
      output: [],
      started: false,
      done: false,
      cancelled: false,
    };
    s.batches.push(b);
  }
  return b;
}

function capOutput(arr: string[]): string[] {
  return arr.length > OUTPUT_CAP_PER_BATCH ? arr.slice(-OUTPUT_CAP_PER_BATCH) : arr;
}

/** Module-level singleton. */
export const sessionStore = new SessionStoreImpl();
export type SessionStore = SessionStoreImpl;
