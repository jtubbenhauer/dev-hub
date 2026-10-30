import type {
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
} from "@/lib/opencode/types";

export type ChatAttention = "waiting" | "working" | "idle";

export type TabAttention = "waiting" | "working" | "unread" | "none";

export interface AttentionWorkspaceSlice {
  readonly sessionStatuses: Readonly<Record<string, SessionStatus>>;
  readonly permissions: readonly PermissionRequest[];
  readonly questions: readonly QuestionRequest[];
}

export const TAB_ATTENTION_DOT_COLORS: Readonly<
  Record<Exclude<TabAttention, "none">, string>
> = {
  waiting: "#ef4444",
  working: "#f59e0b",
  unread: "#3b82f6",
};

export const FAVICON_BLINK_INTERVAL_MS = 1000;

export function selectChatAttention(input: {
  readonly workspaceStates: Readonly<Record<string, AttentionWorkspaceSlice>>;
  readonly connectedWorkspaceIds: readonly string[];
  readonly optimisticStreamingSessionId: string | null;
}): ChatAttention {
  const {
    workspaceStates,
    connectedWorkspaceIds,
    optimisticStreamingSessionId,
  } = input;

  for (const workspaceId of connectedWorkspaceIds) {
    const slice = workspaceStates[workspaceId];
    if (slice === undefined) continue;
    if (slice.permissions.length > 0 || slice.questions.length > 0) {
      return "waiting";
    }
  }

  for (const workspaceId of connectedWorkspaceIds) {
    const slice = workspaceStates[workspaceId];
    if (slice === undefined) continue;
    for (const status of Object.values(slice.sessionStatuses)) {
      if (status.type !== "idle") return "working";
    }
  }

  return optimisticStreamingSessionId !== null ? "working" : "idle";
}

export function resolveTabAttention(
  chatAttention: ChatAttention,
  hasUnseenFinished: boolean,
): TabAttention {
  switch (chatAttention) {
    case "waiting":
      return "waiting";
    case "working":
      return "working";
    case "idle":
      return hasUnseenFinished ? "unread" : "none";
  }
}
