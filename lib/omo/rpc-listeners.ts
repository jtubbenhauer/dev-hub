import type { JsonlRecord } from "@/lib/omo/jsonl";

export type OmoRpcListener = (record: JsonlRecord) => void;

export class OmoRpcListeners {
  private readonly genericListeners = new Set<OmoRpcListener>();
  private readonly sessionListeners = new Map<string, Set<OmoRpcListener>>();

  add(listener: OmoRpcListener): () => void {
    this.genericListeners.add(listener);
    return () => this.genericListeners.delete(listener);
  }

  addSession(sessionId: string, listener: OmoRpcListener): () => void {
    let listeners = this.sessionListeners.get(sessionId);
    if (listeners === undefined) {
      listeners = new Set();
      this.sessionListeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.sessionListeners.get(sessionId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.sessionListeners.delete(sessionId);
    };
  }

  hasSession(sessionId: string): boolean {
    return (this.sessionListeners.get(sessionId)?.size ?? 0) > 0;
  }

  dispatch(record: JsonlRecord, sessionId?: string): void {
    this.dispatchTo(this.genericListeners, record);
    if (sessionId === undefined) return;
    this.dispatchTo(this.sessionListeners.get(sessionId) ?? new Set(), record);
  }

  dispatchAll(record: JsonlRecord): void {
    this.dispatchTo(this.genericListeners, record);
    for (const listeners of this.sessionListeners.values()) {
      this.dispatchTo(listeners, record);
    }
  }

  count(): number {
    let count = this.genericListeners.size;
    for (const listeners of this.sessionListeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  clear(): void {
    this.genericListeners.clear();
    this.sessionListeners.clear();
  }

  private dispatchTo(
    listeners: ReadonlySet<OmoRpcListener>,
    record: JsonlRecord,
  ): void {
    for (const listener of listeners) {
      try {
        listener(record);
      } catch {
        continue;
      }
    }
  }
}
