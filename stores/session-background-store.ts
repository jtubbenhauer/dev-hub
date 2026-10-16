import { create } from "zustand";

import type {
  SessionBackgroundStatus,
  SessionGoalState,
} from "@/lib/opencode/types";

const MAX_TRACKED_SESSIONS = 200;
const SESSION_GOAL_STATES = new Set<string>([
  "active",
  "paused",
  "stopped",
  "blocked",
  "achieved",
]);

interface SessionBackgroundState {
  statusBySession: Record<string, SessionBackgroundStatus>;
  handleEvent: (event: Record<string, unknown>) => void;
  reset: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSessionGoalState(value: unknown): value is SessionGoalState {
  return typeof value === "string" && SESSION_GOAL_STATES.has(value);
}

export function isBackgroundWorkLive(status: SessionBackgroundStatus): boolean {
  return (
    status.goalState === "active" ||
    status.goalWait !== undefined ||
    status.monitors !== undefined
  );
}

function backgroundStatusFrom(
  value: unknown,
): SessionBackgroundStatus | undefined {
  if (!isRecord(value)) return undefined;
  const goal = optionalText(value["goal"]);
  const goalState = value["goalState"];
  const goalWait = optionalText(value["goalWait"]);
  const goalCheckIn = optionalText(value["goalCheckIn"]);
  const monitors = optionalText(value["monitors"]);
  const goalWaitProgress = value["goalWaitProgress"];
  const monitorCount = value["monitorCount"];
  if (goal === undefined && goalWait === undefined && monitors === undefined) {
    return undefined;
  }
  return {
    ...(goal === undefined ? {} : { goal }),
    ...(goal !== undefined && isSessionGoalState(goalState)
      ? { goalState }
      : {}),
    ...(goalWait === undefined ? {} : { goalWait }),
    ...(goalCheckIn === undefined ? {} : { goalCheckIn }),
    ...(typeof goalWaitProgress === "number" &&
    goalWaitProgress >= 0 &&
    goalWaitProgress <= 1
      ? { goalWaitProgress }
      : {}),
    ...(monitors === undefined ? {} : { monitors }),
    ...(typeof monitorCount === "number" &&
    Number.isInteger(monitorCount) &&
    monitorCount > 0
      ? { monitorCount }
      : {}),
  };
}

function withoutSession(
  statusBySession: Record<string, SessionBackgroundStatus>,
  sessionId: string,
): Record<string, SessionBackgroundStatus> {
  return Object.fromEntries(
    Object.entries(statusBySession).filter(([id]) => id !== sessionId),
  );
}

function sessionIdToClear(
  type: unknown,
  properties: Record<string, unknown>,
): string | undefined {
  if (type === "session.deleted") {
    const info = properties["info"];
    return isRecord(info) && typeof info["id"] === "string"
      ? info["id"]
      : undefined;
  }
  if (type !== "session.background" || properties["status"] !== null) {
    return undefined;
  }
  const sessionId = properties["sessionID"];
  return typeof sessionId === "string" ? sessionId : undefined;
}

export const useSessionBackgroundStore = create<SessionBackgroundState>()(
  (set) => ({
    statusBySession: {},
    handleEvent: (event) => {
      const properties = event["properties"];
      if (!isRecord(properties)) return;
      const clearedSessionId = sessionIdToClear(event["type"], properties);
      if (clearedSessionId !== undefined) {
        set((state) =>
          clearedSessionId in state.statusBySession
            ? {
                statusBySession: withoutSession(
                  state.statusBySession,
                  clearedSessionId,
                ),
              }
            : state,
        );
        return;
      }
      if (event["type"] !== "session.background") return;
      const sessionId = properties["sessionID"];
      const status = backgroundStatusFrom(properties["status"]);
      if (typeof sessionId !== "string" || status === undefined) return;
      set((state) => {
        const entries = Object.entries(
          withoutSession(state.statusBySession, sessionId),
        );
        return {
          statusBySession: Object.fromEntries([
            ...entries.slice(
              Math.max(0, entries.length - MAX_TRACKED_SESSIONS + 1),
            ),
            [sessionId, status],
          ]),
        };
      });
    },
    // Each new event stream replays every status still live on the server, so
    // whatever the browser held from before the reconnect is dropped first.
    reset: () => set({ statusBySession: {} }),
  }),
);
