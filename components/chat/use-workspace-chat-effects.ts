import { useActiveChatEngine } from "@/hooks/use-active-chat-engine";
import { useChatStore } from "@/stores/chat-store";
import { usePendingChatStore } from "@/stores/pending-chat-store";
import { useEffect, useRef } from "react";

interface UseWorkspaceChatEffectsArgs {
  readonly workspaceId: string | null;
  readonly healthStatus: string | undefined;
  readonly isWorkspaceRemote: boolean;
  readonly onSessionStarted?: (workspaceId: string, sessionId: string) => void;
}

export function useWorkspaceChatEffects({
  workspaceId,
  healthStatus,
  isWorkspaceRemote,
  onSessionStarted,
}: UseWorkspaceChatEffectsArgs) {
  const {
    setActiveWorkspaceId,
    fetchSessions,
    fetchCommands,
    fetchPinnedSessions,
    fetchSessionNotes,
    createSession,
    sendMessage,
    hasQueuedMessages,
    flushQueuedMessages,
  } = useChatStore.getState();

  // Sync workspace from global workspace store
  useEffect(() => {
    setActiveWorkspaceId(workspaceId);
  }, [workspaceId, setActiveWorkspaceId]);

  const { engine: activeChatEngine, isLoading: isActiveChatEngineLoading } =
    useActiveChatEngine(workspaceId);

  useEffect(() => {
    if (!workspaceId) return;
    fetchSessions(workspaceId);
    fetchPinnedSessions(workspaceId);
    fetchSessionNotes(workspaceId);
  }, [workspaceId, fetchSessions, fetchPinnedSessions, fetchSessionNotes]);

  useEffect(() => {
    if (!workspaceId || isActiveChatEngineLoading) return;
    fetchCommands(workspaceId, activeChatEngine);
  }, [workspaceId, activeChatEngine, isActiveChatEngineLoading, fetchCommands]);

  // Flush queued messages when a remote workspace recovers
  const previousHealthStatusRef = useRef<Record<string, string | undefined>>(
    {},
  );
  useEffect(() => {
    if (!workspaceId || !isWorkspaceRemote) return;

    const previous = previousHealthStatusRef.current[workspaceId];
    previousHealthStatusRef.current[workspaceId] = healthStatus;

    if (healthStatus !== "healthy") return;

    if (
      (previous && previous !== "healthy") ||
      hasQueuedMessages(workspaceId)
    ) {
      flushQueuedMessages(workspaceId);
    }
  }, [
    workspaceId,
    healthStatus,
    isWorkspaceRemote,
    hasQueuedMessages,
    flushQueuedMessages,
  ]);

  // Consume pending chat (e.g. from "Create Worktree" → auto-start plan)
  const pendingChat = usePendingChatStore((s) => s.pending);
  const clearPendingChat = usePendingChatStore((s) => s.clear);
  useEffect(() => {
    if (!workspaceId || !pendingChat) return;
    if (pendingChat.workspaceId !== workspaceId) return;

    const { message } = pendingChat;
    clearPendingChat();

    (async () => {
      const session = await createSession(workspaceId);
      if (!session) return;
      onSessionStarted?.(workspaceId, session.id);
      sendMessage(session.id, message, workspaceId);
    })();
  }, [
    workspaceId,
    pendingChat,
    clearPendingChat,
    createSession,
    sendMessage,
    onSessionStarted,
  ]);
}
