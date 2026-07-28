import type { SessionStatus } from "@/lib/opencode/types";

const MAX_REASON_LENGTH = 80;

type RetryStatus = Extract<SessionStatus, { type: "retry" }>;

export function truncateRetryReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= MAX_REASON_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_REASON_LENGTH)}...`;
}

// OpenCode sends the retry reason on the session.status event as `message`
// (e.g. "Provider is overloaded"). Surface it so the user knows why we waited.
export function formatRetryLabel(status: RetryStatus, now: number): string {
  const secondsUntilRetry = Math.max(0, Math.ceil((status.next - now) / 1000));

  let label = `Retrying... attempt ${status.attempt}`;
  if (secondsUntilRetry > 0) label += ` · ${secondsUntilRetry}s`;

  const reason = truncateRetryReason(status.message ?? "");
  if (reason) label += ` · ${reason}`;

  return label;
}
