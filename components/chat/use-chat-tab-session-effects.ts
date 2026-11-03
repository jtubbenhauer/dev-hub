import { useChatStore } from "@/stores/chat-store";
import { useEffect } from "react";

interface UseChatTabSessionEffectsArgs {
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
  readonly isVisible: boolean;
}

// A hidden tab loads its session once it is shown, so restoring a layout with
// many background chat tabs does not fetch every transcript at once.
export function useChatTabSessionEffects({
  workspaceId,
  sessionId,
  isVisible,
}: UseChatTabSessionEffectsArgs) {
  const {
    fetchMessages,
    fetchSessionTodos,
    registerVisibleSession,
    unregisterVisibleSession,
  } = useChatStore.getState();

  useEffect(() => {
    if (!isVisible || !sessionId || !workspaceId) return;
    fetchMessages(sessionId, workspaceId);
  }, [isVisible, sessionId, workspaceId, fetchMessages]);

  useEffect(() => {
    if (!isVisible || !sessionId || !workspaceId) return;
    void fetchSessionTodos(sessionId, workspaceId);
  }, [isVisible, sessionId, workspaceId, fetchSessionTodos]);

  useEffect(() => {
    if (!isVisible || !sessionId || !workspaceId) return;
    registerVisibleSession(workspaceId, sessionId);
    return () => unregisterVisibleSession(workspaceId, sessionId);
  }, [
    isVisible,
    sessionId,
    workspaceId,
    registerVisibleSession,
    unregisterVisibleSession,
  ]);
}
