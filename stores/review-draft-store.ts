import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ReviewDraft {
  id: string;
  type: "inline" | "reply";
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  startLine?: number;
  replyToId?: number;
}

interface ReviewDraftState {
  drafts: Record<string, ReviewDraft[]>;

  addDraft: (prKey: string, draft: Omit<ReviewDraft, "id">) => void;
  removeDraft: (prKey: string, draftId: string) => void;
  updateDraft: (prKey: string, draftId: string, body: string) => void;
  getDrafts: (prKey: string) => ReviewDraft[];
  getDraftsForFile: (prKey: string, path: string) => ReviewDraft[];
  clearDrafts: (prKey: string) => void;
}

export const useReviewDraftStore = create<ReviewDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},

      addDraft: (prKey, draft) =>
        set((state) => {
          const current = state.drafts[prKey] ?? [];
          const nextDraft: ReviewDraft = {
            ...draft,
            id: crypto.randomUUID(),
          };
          return {
            drafts: {
              ...state.drafts,
              [prKey]: [...current, nextDraft],
            },
          };
        }),

      removeDraft: (prKey, draftId) =>
        set((state) => {
          const current = state.drafts[prKey] ?? [];
          const next = current.filter((draft) => draft.id !== draftId);
          if (next.length === 0) {
            const { [prKey]: _, ...rest } = state.drafts;
            return { drafts: rest };
          }
          return {
            drafts: {
              ...state.drafts,
              [prKey]: next,
            },
          };
        }),

      updateDraft: (prKey, draftId, body) =>
        set((state) => {
          const current = state.drafts[prKey] ?? [];
          const next = current.map((draft) =>
            draft.id === draftId ? { ...draft, body } : draft,
          );
          return {
            drafts: {
              ...state.drafts,
              [prKey]: next,
            },
          };
        }),

      getDrafts: (prKey) => get().drafts[prKey] ?? [],

      getDraftsForFile: (prKey, path) =>
        (get().drafts[prKey] ?? []).filter((draft) => draft.path === path),

      clearDrafts: (prKey) =>
        set((state) => {
          const { [prKey]: _, ...rest } = state.drafts;
          return { drafts: rest };
        }),
    }),
    {
      name: "dev-hub-review-drafts",
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);
