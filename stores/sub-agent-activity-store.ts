import { create } from "zustand";

import type { SubAgentActivity } from "@/lib/opencode/types";

const MAX_TRACKED_SESSIONS = 200;

interface SubAgentActivityState {
  activityBySession: Record<string, SubAgentActivity>;
  handleEvent: (event: Record<string, unknown>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activityFromEvent(value: unknown): SubAgentActivity | undefined {
  if (
    !isRecord(value) ||
    typeof value["summary"] !== "string" ||
    typeof value["turns"] !== "number" ||
    typeof value["updatedAt"] !== "number"
  ) {
    return undefined;
  }
  const currentTool = value["currentTool"];
  const lastLine = value["lastLine"];
  const toolCalls = value["toolCalls"];
  return {
    summary: value["summary"],
    turns: value["turns"],
    updatedAt: value["updatedAt"],
    ...(typeof currentTool === "string" ? { currentTool } : {}),
    ...(typeof lastLine === "string" ? { lastLine } : {}),
    ...(typeof toolCalls === "number" ? { toolCalls } : {}),
  };
}

function sessionIdToClear(
  type: unknown,
  properties: Record<string, unknown>,
): string | undefined {
  if (type === "session.status") {
    const status = properties["status"];
    return isRecord(status) &&
      status["type"] === "idle" &&
      typeof properties["sessionID"] === "string"
      ? properties["sessionID"]
      : undefined;
  }
  if (type === "session.deleted") {
    const info = properties["info"];
    return isRecord(info) && typeof info["id"] === "string"
      ? info["id"]
      : undefined;
  }
  return undefined;
}

function withoutSession(
  activityBySession: Record<string, SubAgentActivity>,
  sessionId: string,
): Record<string, SubAgentActivity> {
  return Object.fromEntries(
    Object.entries(activityBySession).filter(([id]) => id !== sessionId),
  );
}

export const useSubAgentActivityStore = create<SubAgentActivityState>()(
  (set) => ({
    activityBySession: {},
    handleEvent: (event) => {
      const properties = event["properties"];
      if (!isRecord(properties)) return;
      const clearedSessionId = sessionIdToClear(event["type"], properties);
      if (clearedSessionId !== undefined) {
        set((state) =>
          clearedSessionId in state.activityBySession
            ? {
                activityBySession: withoutSession(
                  state.activityBySession,
                  clearedSessionId,
                ),
              }
            : state,
        );
        return;
      }
      if (event["type"] !== "session.activity") return;
      const sessionId = properties["sessionID"];
      const activity = activityFromEvent(properties["activity"]);
      if (typeof sessionId !== "string" || activity === undefined) return;
      set((state) => {
        const entries = Object.entries(
          withoutSession(state.activityBySession, sessionId),
        );
        return {
          activityBySession: Object.fromEntries([
            ...entries.slice(
              Math.max(0, entries.length - MAX_TRACKED_SESSIONS + 1),
            ),
            [sessionId, activity],
          ]),
        };
      });
    },
  }),
);
