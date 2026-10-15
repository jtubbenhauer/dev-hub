import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
  splitGlobList,
  type ContentSearchQuery,
} from "@devhub/shared";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";

export type SidebarView = "explorer" | "search";

export interface ContentSearchFields {
  readonly pattern: string;
  readonly isRegex: boolean;
  readonly isCaseSensitive: boolean;
  readonly isWholeWord: boolean;
  readonly includeText: string;
  readonly excludeText: string;
}

interface PersistedContentSearchState extends ContentSearchFields {
  readonly isDetailsOpen: boolean;
  readonly sidebarView: SidebarView;
}

// Search results are server state (TanStack Query); this store only holds the form.
interface ContentSearchState extends PersistedContentSearchState {
  readonly pendingFocus: boolean;

  setPattern: (pattern: string) => void;
  setIsRegex: (isRegex: boolean) => void;
  setIsCaseSensitive: (isCaseSensitive: boolean) => void;
  setIsWholeWord: (isWholeWord: boolean) => void;
  setIncludeText: (includeText: string) => void;
  setExcludeText: (excludeText: string) => void;
  setIsDetailsOpen: (isDetailsOpen: boolean) => void;
  setSidebarView: (sidebarView: SidebarView) => void;
  requestOpen: (prefill: string | null) => void;
  consumeFocus: () => void;
}

export function buildContentSearchQuery(
  fields: ContentSearchFields,
): ContentSearchQuery {
  return {
    pattern: fields.pattern,
    isRegex: fields.isRegex,
    isCaseSensitive: fields.isCaseSensitive,
    isWholeWord: fields.isWholeWord,
    includeGlobs: splitGlobList(fields.includeText),
    excludeGlobs: splitGlobList(fields.excludeText),
    maxResults: CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
  };
}

export const useContentSearchStore = create<ContentSearchState>()(
  persist(
    (set) => ({
      pattern: "",
      isRegex: false,
      isCaseSensitive: false,
      isWholeWord: false,
      includeText: "",
      excludeText: "",
      isDetailsOpen: false,
      sidebarView: "explorer",
      pendingFocus: false,

      setPattern: (pattern) => set({ pattern }),
      setIsRegex: (isRegex) => set({ isRegex }),
      setIsCaseSensitive: (isCaseSensitive) => set({ isCaseSensitive }),
      setIsWholeWord: (isWholeWord) => set({ isWholeWord }),
      setIncludeText: (includeText) => set({ includeText }),
      setExcludeText: (excludeText) => set({ excludeText }),
      setIsDetailsOpen: (isDetailsOpen) => set({ isDetailsOpen }),
      setSidebarView: (sidebarView) => set({ sidebarView }),
      requestOpen: (prefill) =>
        set(
          prefill
            ? { sidebarView: "search", pattern: prefill, pendingFocus: true }
            : { sidebarView: "search", pendingFocus: true },
        ),
      consumeFocus: () => set({ pendingFocus: false }),
    }),
    {
      name: "dev-hub:content-search",
      storage: createUnchangedPersistStorage(),
      partialize: (state): PersistedContentSearchState => ({
        pattern: state.pattern,
        isRegex: state.isRegex,
        isCaseSensitive: state.isCaseSensitive,
        isWholeWord: state.isWholeWord,
        includeText: state.includeText,
        excludeText: state.excludeText,
        isDetailsOpen: state.isDetailsOpen,
        sidebarView: state.sidebarView,
      }),
    },
  ),
);
