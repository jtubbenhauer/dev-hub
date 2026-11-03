import type { WorkspaceState } from "@/stores/chat-store";

export type ChatSessionListSource = Pick<
  WorkspaceState,
  "sessions" | "sessionsLoaded"
>;

// A session is only known to be missing once the workspace's session list has
// loaded without it; until then the requested id is trusted.
export function getEffectiveChatSessionId(
  workspaceState: ChatSessionListSource | undefined,
  sessionId: string | null,
): string | null {
  if (sessionId === null) return null;
  if (
    workspaceState?.sessionsLoaded &&
    !Object.hasOwn(workspaceState.sessions, sessionId)
  ) {
    return null;
  }
  return sessionId;
}
