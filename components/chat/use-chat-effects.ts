import { useChatStore } from "@/stores/chat-store";
import { usePendingChatStore } from "@/stores/pending-chat-store";
import { useEffect, useRef } from "react";

interface UseChatEffectsArgs {
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  healthStatus: string | undefined;
  isActiveWorkspaceRemote: boolean;
}

export function useChatEffects({
  activeWorkspaceId,
  activeSessionId,
  healthStatus,
  isActiveWorkspaceRemote,
}: UseChatEffectsArgs) {
  const {
    setActiveWorkspaceId,
    fetchSessions,
    fetchMessages,
    fetchCommands,
    fetchPinnedSessions,
    createSession,
    sendMessage,
    hasQueuedMessages,
    flushQueuedMessages,
  } = useChatStore.getState();

  // Sync workspace from global workspace store
  useEffect(() => {
    setActiveWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, setActiveWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchSessions(activeWorkspaceId);
    fetchCommands(activeWorkspaceId);
    fetchPinnedSessions(activeWorkspaceId);
  }, [activeWorkspaceId, fetchSessions, fetchCommands, fetchPinnedSessions]);

  // Fetch messages when active session changes
  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) return;
    fetchMessages(activeSessionId, activeWorkspaceId);
  }, [activeSessionId, activeWorkspaceId, fetchMessages]);

  // Flush queued messages when a remote workspace recovers
  const previousHealthStatusRef = useRef<Record<string, string | undefined>>(
    {},
  );
  useEffect(() => {
    if (!activeWorkspaceId || !isActiveWorkspaceRemote) return;

    const previous = previousHealthStatusRef.current[activeWorkspaceId];
    previousHealthStatusRef.current[activeWorkspaceId] = healthStatus;

    if (healthStatus !== "healthy") return;

    if (
      (previous && previous !== "healthy") ||
      hasQueuedMessages(activeWorkspaceId)
    ) {
      flushQueuedMessages(activeWorkspaceId);
    }
  }, [
    activeWorkspaceId,
    healthStatus,
    isActiveWorkspaceRemote,
    hasQueuedMessages,
    flushQueuedMessages,
  ]);

  // Consume pending chat (e.g. from "Create Worktree" → auto-start plan)
  const pendingChat = usePendingChatStore((s) => s.pending);
  const clearPendingChat = usePendingChatStore((s) => s.clear);
  useEffect(() => {
    if (!activeWorkspaceId || !pendingChat) return;
    if (pendingChat.workspaceId !== activeWorkspaceId) return;

    const { message } = pendingChat;
    clearPendingChat();

    (async () => {
      const session = await createSession(activeWorkspaceId);
      if (!session) return;
      sendMessage(session.id, message, activeWorkspaceId);
    })();
  }, [
    activeWorkspaceId,
    pendingChat,
    clearPendingChat,
    createSession,
    sendMessage,
  ]);
}
