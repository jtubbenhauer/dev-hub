import { create } from "zustand";

interface PendingChat {
  workspaceId: string;
  message: string;
}

interface PendingChatStore {
  pending: PendingChat | null;
  setPending: (pending: PendingChat) => void;
  clear: () => void;
}

/**
 * Transient one-shot store for auto-starting a chat session after navigation.
 *
 * Usage:
 *  1. Producer (e.g. TaskWorktreeDialog) calls `setPending({ workspaceId, message })`
 *     then navigates to /chat.
 *  2. Consumer (ChatInterface) subscribes to `pending` reactively. When the
 *     pending workspace matches the active workspace, it creates a session,
 *     sends the message, and calls `clear()`.
 */
export const usePendingChatStore = create<PendingChatStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}));
