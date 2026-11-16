"use client";

import { useChatTab } from "@/components/chat/chat-tab-context";
import type { QueryClient } from "@tanstack/react-query";
import {
  useWorkspaceEngine,
  workspaceEngineQueryKey,
} from "@/hooks/use-workspace-engine";
import {
  CHAT_ENGINE_SETTING_KEY,
  engineForSessionId,
  isChatEngine,
  type ChatEngine,
} from "@/lib/engine/types";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";

export interface ChatEngineResult {
  readonly engine: ChatEngine;
  readonly isLoading: boolean;
}

export function useNewChatEngine(workspaceId: string | null): ChatEngineResult {
  const chosenEngine = useNewChatEngineStore((state) =>
    workspaceId === null ? undefined : state.engineByWorkspace[workspaceId],
  );
  const workspaceDefault = useWorkspaceEngine(workspaceId);
  if (chosenEngine !== undefined) {
    return { engine: chosenEngine, isLoading: false };
  }
  return workspaceDefault;
}

// The engine a message is about to go to, read without subscribing: a session
// id names it; a new chat uses the picked engine, then the cached workspace
// override and global setting (same precedence as useWorkspaceEngine).
export function getChatEngineForSend(
  queryClient: QueryClient,
  workspaceId: string,
  sessionId: string | null,
): ChatEngine {
  if (sessionId !== null) return engineForSessionId(sessionId);
  const chosenEngine =
    useNewChatEngineStore.getState().engineByWorkspace[workspaceId];
  if (chosenEngine !== undefined) return chosenEngine;
  const workspaceOverride = queryClient.getQueryData<string | null>(
    workspaceEngineQueryKey(workspaceId),
  );
  const settings = queryClient.getQueryData<Record<string, unknown>>([
    "settings",
  ]);
  const selectedEngine =
    workspaceOverride ?? settings?.[CHAT_ENGINE_SETTING_KEY] ?? "opencode";
  return isChatEngine(selectedEngine) ? selectedEngine : "opencode";
}

// A chat tab showing this workspace owns the answer, so a background tab never
// takes the engine of the chat that is focused (the global active session).
export function useActiveChatEngine(
  workspaceId: string | null,
): ChatEngineResult {
  const chatTab = useChatTab();
  const isTabWorkspace =
    chatTab !== null && chatTab.workspaceId === workspaceId;
  const globalSessionId = useChatStore((state) =>
    !isTabWorkspace &&
    workspaceId !== null &&
    state.activeWorkspaceId === workspaceId
      ? state.activeSessionId
      : null,
  );
  const newChatEngine = useNewChatEngine(workspaceId);
  const activeSessionId = isTabWorkspace ? chatTab.sessionId : globalSessionId;
  if (activeSessionId !== null) {
    return { engine: engineForSessionId(activeSessionId), isLoading: false };
  }
  return newChatEngine;
}
