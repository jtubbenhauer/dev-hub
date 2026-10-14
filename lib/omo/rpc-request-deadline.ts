import type { JsonlRecord } from "@/lib/omo/jsonl";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// senpi's RpcClient budgets: an answer held behind compaction may wait for
// 15 minutes of remote compaction plus a 30-minute local summary, and a prompt
// the host acknowledged with `queued` may wait 5 minutes on a busy session.
const COMPACTION_TIMEOUT_MS = 45 * 60_000 + DEFAULT_REQUEST_TIMEOUT_MS;
const ACKNOWLEDGED_PROMPT_TIMEOUT_MS = 5 * 60_000;
const MAX_COMPACTION_BOUND_WAIT_MS =
  COMPACTION_TIMEOUT_MS + DEFAULT_REQUEST_TIMEOUT_MS;
const COMPACTION_BOUND_COMMANDS = new Set(["prompt", "compact"]);

function compactionOperationKey(record: JsonlRecord): string {
  const requestId = record["requestId"];
  return typeof requestId === "string" ? requestId : "";
}

export class OmoCompactionTracker {
  private readonly startedAtBySession = new Map<string, Map<string, number>>();

  sessionWithChangedCompaction(record: JsonlRecord): string | undefined {
    const sessionId = record["sessionId"];
    if (typeof sessionId !== "string") return undefined;
    const type = record["type"];
    if (type === "compaction_start") {
      const operations = this.startedAtBySession.get(sessionId) ?? new Map();
      const key = compactionOperationKey(record);
      if (operations.has(key)) return undefined;
      operations.set(key, Date.now());
      this.startedAtBySession.set(sessionId, operations);
      return sessionId;
    }
    if (type === "compaction_end") {
      const operations = this.startedAtBySession.get(sessionId);
      if (!operations?.delete(compactionOperationKey(record))) return undefined;
      if (operations.size === 0) this.startedAtBySession.delete(sessionId);
      return sessionId;
    }
    if (type === "session_replaced") {
      return this.startedAtBySession.delete(sessionId) ? sessionId : undefined;
    }
    return undefined;
  }

  isCompacting(sessionId: string): boolean {
    const operations = this.startedAtBySession.get(sessionId);
    if (operations === undefined) return false;
    const now = Date.now();
    // A start whose end never arrived stops counting once it outlives the budget.
    for (const [key, startedAt] of operations) {
      if (now - startedAt >= COMPACTION_TIMEOUT_MS) operations.delete(key);
    }
    if (operations.size === 0) this.startedAtBySession.delete(sessionId);
    return operations.size > 0;
  }

  clear(): void {
    this.startedAtBySession.clear();
  }
}

type OmoRequestDeadlineOptions = {
  readonly command: string;
  readonly sessionId: string | undefined;
  readonly timeoutMs: number;
  readonly compactions: OmoCompactionTracker;
  readonly onExpire: () => void;
};

export class OmoRequestDeadline {
  private readonly compactionSessionId: string | undefined;
  private readonly timeoutMs: number;
  private readonly compactions: OmoCompactionTracker;
  private readonly onExpire: () => void;
  private readonly maxWaitTimer: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout;
  private isAcknowledged = false;

  constructor(options: OmoRequestDeadlineOptions) {
    this.compactionSessionId = COMPACTION_BOUND_COMMANDS.has(options.command)
      ? options.sessionId
      : undefined;
    this.timeoutMs = options.timeoutMs;
    this.compactions = options.compactions;
    this.onExpire = options.onExpire;
    this.timer = setTimeout(() => this.expire(), this.nextTimeoutMs());
    this.maxWaitTimer =
      this.compactionSessionId === undefined
        ? undefined
        : setTimeout(() => this.expire(), MAX_COMPACTION_BOUND_WAIT_MS);
  }

  acknowledge(): void {
    if (this.compactionSessionId === undefined) return;
    this.isAcknowledged = true;
    this.restart();
  }

  compactionChanged(sessionId: string): void {
    if (sessionId === this.compactionSessionId) this.restart();
  }

  clear(): void {
    clearTimeout(this.timer);
    clearTimeout(this.maxWaitTimer);
  }

  private nextTimeoutMs(): number {
    if (
      this.compactionSessionId !== undefined &&
      this.compactions.isCompacting(this.compactionSessionId)
    ) {
      return COMPACTION_TIMEOUT_MS;
    }
    return this.isAcknowledged
      ? ACKNOWLEDGED_PROMPT_TIMEOUT_MS
      : this.timeoutMs;
  }

  private restart(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), this.nextTimeoutMs());
  }

  private expire(): void {
    this.clear();
    this.onExpire();
  }
}
