"use client";

import { useChatTab } from "@/components/chat/chat-tab-context";
import { useWorkspaceEngine } from "@/hooks/use-workspace-engine";
import { engineForSessionId, type ChatEngine } from "@/lib/engine/types";
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
