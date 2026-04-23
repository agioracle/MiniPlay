/**
 * Per-project ring buffer of Coder-related events (`agent:stream` channel).
 *
 * Events in a session are stored as a **unified stream** `BufferedEvent[]`,
 * each one carries a globally monotonically increasing `seq` (assigned by
 * CoderSessionManager) so the renderer can deduplicate across
 * `coder:subscribe` snapshot + live stream boundary.
 *
 * Retention policy:
 *  - `output` events (coder-output) are retained up to `outputCapacity`
 *    (default 500) per session; older ones fall out of the ring to bound
 *    memory on long-running sessions.
 *  - `status` / `tool-call` / `tool-result` / `agent-message` / other events
 *    are kept in full (they are rare and critical to reconstruct batch
 *    grouping and tool-call state on replay).
 *
 * Batches are derived lazily from `tool-call` / `tool-result` / status events
 * based on the `batchId` field carried in each event's payload.
 */

export type BufferedEventType =
  | 'status'
  | 'output'
  | 'tool-call'
  | 'tool-result'
  | 'agent-message';

export interface BufferedEvent {
  /** Global monotonically increasing sequence number (assigned by manager). */
  seq: number;
  /** Batch id this event belongs to (null when not part of a coder batch). */
  batchId: string | null;
  type: BufferedEventType;
  /**
   * Payload mirrors the existing `agent:stream` event shape for this type.
   * The manager will merge `{ seq, projectPath }` onto payload when broadcasting.
   */
  payload: Record<string, unknown>;
  /** Timestamp (ms since epoch) when the event was enqueued. */
  at: number;
}

export interface BufferedBatchSummary {
  batchId: string;
  started: boolean;
  done: boolean;
  /** Most recent coder-status text observed (or null). */
  status: string | null;
}

export interface CoderBufferSnapshot {
  /** Events in ascending seq order. */
  events: BufferedEvent[];
  /** Highest seq currently in the buffer — renderer uses this as lastAppliedSeq. */
  lastSeq: number;
  /** Batch summary aggregated from events (for UI badge/filter fast-path). */
  batches: BufferedBatchSummary[];
}

const DEFAULT_OUTPUT_CAPACITY = 500;

export class CoderBuffer {
  private events: BufferedEvent[] = [];
  private outputCapacity: number;
  private outputCount = 0;

  constructor(outputCapacity = DEFAULT_OUTPUT_CAPACITY) {
    this.outputCapacity = outputCapacity;
  }

  /**
   * Append a new event. Caller (CoderSessionManager) is responsible for
   * assigning the global `seq` beforehand.
   *
   * For `output` events exceeding capacity, the oldest `output` event is
   * evicted (other event types are never evicted to preserve replay integrity).
   */
  append(event: BufferedEvent): void {
    this.events.push(event);
    if (event.type === 'output') {
      this.outputCount += 1;
      if (this.outputCount > this.outputCapacity) {
        // Find and drop oldest output event (linear scan; small constant)
        for (let i = 0; i < this.events.length; i++) {
          if (this.events[i].type === 'output') {
            this.events.splice(i, 1);
            this.outputCount -= 1;
            break;
          }
        }
      }
    }
  }

  /** Return a shallow snapshot suitable for IPC serialization. */
  snapshot(): CoderBufferSnapshot {
    const events = this.events.slice();
    const lastSeq = events.length > 0 ? events[events.length - 1].seq : 0;

    // Aggregate batches from events.
    const byId = new Map<string, BufferedBatchSummary>();
    for (const evt of events) {
      if (!evt.batchId) continue;
      let entry = byId.get(evt.batchId);
      if (!entry) {
        entry = { batchId: evt.batchId, started: false, done: false, status: null };
        byId.set(evt.batchId, entry);
      }
      if (evt.type === 'tool-call') {
        entry.started = true;
      }
      if (evt.type === 'status' || evt.type === 'output') {
        entry.started = true;
      }
      if (evt.type === 'status') {
        const text = typeof evt.payload?.text === 'string' ? (evt.payload.text as string) : null;
        if (text) entry.status = text;
      }
      // A batch is considered done when the agent emits a terminal marker
      // (`__terminal:true` or `__done:true` on any payload — we accept both
      // because producers are inconsistent: `self-heal.ts` uses `__terminal`,
      // `ipc/coder.ts` uses `__done`, and `session-manager.killAll` writes
      // both for safety), a `status` text equal to 'done' / 'failed' /
      // 'cancelled', or the closing `tool-result` for its own
      // `send_to_coder` / root tool call (toolCallId === batchId).
      const statusText = evt.type === 'status' && typeof evt.payload?.text === 'string'
        ? (evt.payload.text as string).toLowerCase()
        : '';
      const terminalStatus = ['done', 'failed', 'cancelled', 'interrupted'].includes(statusText);
      const closingToolResult =
        evt.type === 'tool-result' &&
        typeof evt.payload?.toolCallId === 'string' &&
        evt.payload.toolCallId === evt.batchId;
      const terminal =
        evt.payload?.__terminal === true ||
        evt.payload?.__done === true ||
        terminalStatus ||
        closingToolResult;
      if (terminal) entry.done = true;
    }

    return {
      events,
      lastSeq,
      batches: Array.from(byId.values()),
    };
  }

  /** Reset the buffer — called by CoderSessionManager.closeSession. */
  clear(): void {
    this.events = [];
    this.outputCount = 0;
  }
}
