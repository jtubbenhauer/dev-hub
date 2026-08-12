import { useEffect } from "react";
import { useChatStore } from "@/stores/chat-store";
import type {
  MessageWithParts,
  SessionStatus,
  Todo,
} from "@/lib/opencode/types";

const EMPTY_MESSAGES: MessageWithParts[] = [];
const EMPTY_TODOS: Todo[] = [];
const ACTIVE_REFRESH_INTERVAL_MS = 3_000;

interface UseSubAgentSessionOptions {
  readonly childSessionId: string | null;
  readonly workspaceId: string;
  readonly isOpen: boolean;
  readonly isActive: boolean;
}

interface SubAgentSessionData {
  readonly messages: MessageWithParts[];
  readonly todos: Todo[];
  readonly sessionStatus: SessionStatus | null;
}

export function useSubAgentSession({
  childSessionId,
  workspaceId,
  isOpen,
  isActive,
}: UseSubAgentSessionOptions): SubAgentSessionData {
  const messages = useChatStore((state) =>
    childSessionId
      ? (state.workspaceStates[workspaceId]?.messages[childSessionId] ??
        EMPTY_MESSAGES)
      : EMPTY_MESSAGES,
  );
  const todos = useChatStore((state) =>
    childSessionId
      ? (state.workspaceStates[workspaceId]?.todos[childSessionId] ??
        EMPTY_TODOS)
      : EMPTY_TODOS,
  );
  const sessionStatus = useChatStore((state) =>
    childSessionId
      ? (state.workspaceStates[workspaceId]?.sessionStatuses[childSessionId] ??
        null)
      : null,
  );
  const fetchMessages = useChatStore((state) => state.fetchMessages);
  const fetchSessionTodos = useChatStore((state) => state.fetchSessionTodos);

  useEffect(() => {
    if (!isOpen || !childSessionId || !workspaceId) return;

    void fetchMessages(childSessionId, workspaceId, { force: true });
    void fetchSessionTodos(childSessionId, workspaceId);
    if (!isActive) return;

    const interval = setInterval(() => {
      void fetchMessages(childSessionId, workspaceId, { force: true });
    }, ACTIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [
    childSessionId,
    fetchMessages,
    fetchSessionTodos,
    isActive,
    isOpen,
    workspaceId,
  ]);

  return { messages, todos, sessionStatus };
}
