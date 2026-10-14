import { create } from "zustand";

import type { ChatEngine } from "@/lib/engine/types";

interface NewChatEngineState {
  engineByWorkspace: Record<string, ChatEngine>;
  setNewChatEngine: (workspaceId: string, engine: ChatEngine) => void;
}

export const useNewChatEngineStore = create<NewChatEngineState>()((set) => ({
  engineByWorkspace: {},
  setNewChatEngine: (workspaceId, engine) =>
    set((state) => ({
      engineByWorkspace: { ...state.engineByWorkspace, [workspaceId]: engine },
    })),
}));

export function getNewChatEngineChoice(
  workspaceId: string,
): ChatEngine | undefined {
  return useNewChatEngineStore.getState().engineByWorkspace[workspaceId];
}
