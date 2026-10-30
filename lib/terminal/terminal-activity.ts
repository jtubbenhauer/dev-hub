import {
  terminalSessionKey,
  type TerminalFinishedCommand,
  type TerminalSessionInfo,
} from "./terminal-protocol";

export const FINISH_NOTIFY_MIN_DURATION_MS = 10_000;

export interface TerminalActivityBaseline {
  seenOutputAt: Record<string, number>;
  notifiedFinishAt: Record<string, number>;
}

export interface FinishedTerminalCommand {
  session: TerminalSessionInfo;
  command: TerminalFinishedCommand;
}

export interface TerminalActivityUpdate {
  baseline: TerminalActivityBaseline;
  unseenActivityKeys: Record<string, true>;
  finishedCommands: FinishedTerminalCommand[];
}

export const EMPTY_ACTIVITY_BASELINE: TerminalActivityBaseline = {
  seenOutputAt: {},
  notifiedFinishAt: {},
};

// The first time a session is seen its current state becomes the baseline, so
// reloading the page never reports old output or old commands as new.
export function computeTerminalActivity(
  sessions: TerminalSessionInfo[],
  previous: TerminalActivityBaseline,
  visibleKey: string | null,
): TerminalActivityUpdate {
  const seenOutputAt: Record<string, number> = {};
  const notifiedFinishAt: Record<string, number> = {};
  const unseenActivityKeys: Record<string, true> = {};
  const finishedCommands: FinishedTerminalCommand[] = [];

  for (const session of sessions) {
    const key = terminalSessionKey(session.workspaceId, session.sessionId);
    const isVisible = key === visibleKey;

    const lastSeen = previous.seenOutputAt[key];
    if (lastSeen === undefined || isVisible) {
      seenOutputAt[key] = session.lastOutputAt;
    } else {
      seenOutputAt[key] = lastSeen;
      if (session.lastOutputAt > lastSeen) unseenActivityKeys[key] = true;
    }

    const command = session.lastFinishedCommand;
    const finishedAt = command?.finishedAt ?? 0;
    const lastNotified = previous.notifiedFinishAt[key];
    notifiedFinishAt[key] = Math.max(lastNotified ?? 0, finishedAt);
    if (
      command &&
      lastNotified !== undefined &&
      finishedAt > lastNotified &&
      !isVisible &&
      command.durationMs >= FINISH_NOTIFY_MIN_DURATION_MS
    ) {
      finishedCommands.push({ session, command });
    }
  }

  return {
    baseline: { seenOutputAt, notifiedFinishAt },
    unseenActivityKeys,
    finishedCommands,
  };
}

export function markTerminalSeen(
  baseline: TerminalActivityBaseline,
  key: string,
  seenAt: number,
): TerminalActivityBaseline {
  return {
    ...baseline,
    seenOutputAt: { ...baseline.seenOutputAt, [key]: seenAt },
  };
}

export function formatCommandDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
