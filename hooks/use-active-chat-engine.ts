"use client";

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

export function useActiveChatEngine(
  workspaceId: string | null,
): ChatEngineResult {
  const activeSessionId = useChatStore((state) =>
    workspaceId !== null && state.activeWorkspaceId === workspaceId
      ? state.activeSessionId
      : null,
  );
  const newChatEngine = useNewChatEngine(workspaceId);
  if (activeSessionId !== null) {
    return { engine: engineForSessionId(activeSessionId), isLoading: false };
  }
  return newChatEngine;
}
