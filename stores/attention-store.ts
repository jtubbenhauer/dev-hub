import { create } from "zustand";

export const MAX_UNSEEN_FINISHED = 200;

export function attentionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

interface AttentionState {
  unseenFinishedKeys: string[];
  markFinishedUnseen: (workspaceId: string, sessionId: string) => void;
  clearUnseen: (workspaceId: string, sessionId: string) => void;
  clearWorkspaceUnseen: (workspaceId: string) => void;
}

export const useAttentionStore = create<AttentionState>()((set) => ({
  unseenFinishedKeys: [],
  markFinishedUnseen: (workspaceId, sessionId) => {
    const key = attentionKey(workspaceId, sessionId);
    set((state) => {
      const withoutKey = state.unseenFinishedKeys.filter(
        (existingKey) => existingKey !== key,
      );
      const withKey = [...withoutKey, key];
      return {
        unseenFinishedKeys: withKey.slice(
          Math.max(0, withKey.length - MAX_UNSEEN_FINISHED),
        ),
      };
    });
  },
  clearUnseen: (workspaceId, sessionId) => {
    const key = attentionKey(workspaceId, sessionId);
    set((state) =>
      state.unseenFinishedKeys.includes(key)
        ? {
            unseenFinishedKeys: state.unseenFinishedKeys.filter(
              (existingKey) => existingKey !== key,
            ),
          }
        : state,
    );
  },
  clearWorkspaceUnseen: (workspaceId) => {
    const prefix = `${workspaceId}:`;
    set((state) =>
      state.unseenFinishedKeys.some((key) => key.startsWith(prefix))
        ? {
            unseenFinishedKeys: state.unseenFinishedKeys.filter(
              (key) => !key.startsWith(prefix),
            ),
          }
        : state,
    );
  },
}));
