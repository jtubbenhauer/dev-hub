import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";

const CONTEXT_SIDEBAR_VIEWS = [
  "explorer",
  "changes",
  "compare",
  "status",
] as const;

export type ContextSidebarView = (typeof CONTEXT_SIDEBAR_VIEWS)[number];

export type ContextSidebarFocusTarget = "tree" | "file-search";

const DEFAULT_VIEW: ContextSidebarView = "explorer";
const DEFAULT_IS_OPEN = true;

interface PersistedContextSidebarState {
  isOpen: boolean;
  view: ContextSidebarView;
  branchCompareBaseRefs: Record<string, string>;
}

interface ContextSidebarState extends PersistedContextSidebarState {
  focusRequest: ContextSidebarFocusTarget | null;

  setOpen: (isOpen: boolean) => void;
  toggle: () => void;
  setView: (view: ContextSidebarView) => void;
  openView: (view: ContextSidebarView) => void;
  setBranchCompareBaseRef: (workspaceId: string, baseRef: string) => void;
  requestFocus: (target: ContextSidebarFocusTarget) => void;
  consumeFocusRequest: () => ContextSidebarFocusTarget | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContextSidebarView(value: unknown): value is ContextSidebarView {
  return CONTEXT_SIDEBAR_VIEWS.some((view) => view === value);
}

function sanitizeBaseRefs(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const baseRefs: Record<string, string> = {};
  for (const [workspaceId, baseRef] of Object.entries(value)) {
    if (typeof baseRef === "string" && baseRef !== "") {
      baseRefs[workspaceId] = baseRef;
    }
  }
  return baseRefs;
}

export const useContextSidebarStore = create<ContextSidebarState>()(
  persist(
    (set, get) => ({
      isOpen: DEFAULT_IS_OPEN,
      view: DEFAULT_VIEW,
      branchCompareBaseRefs: {},
      focusRequest: null,

      setOpen: (isOpen) => set({ isOpen }),

      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      setView: (view) => set({ view }),

      openView: (view) => set({ view, isOpen: true }),

      setBranchCompareBaseRef: (workspaceId, baseRef) =>
        set((state) => ({
          branchCompareBaseRefs: {
            ...state.branchCompareBaseRefs,
            [workspaceId]: baseRef,
          },
        })),

      requestFocus: (focusRequest) => set({ focusRequest }),

      consumeFocusRequest: () => {
        const { focusRequest } = get();
        if (focusRequest !== null) set({ focusRequest: null });
        return focusRequest;
      },
    }),
    {
      name: "dev-hub:context-sidebar",
      version: 1,
      storage: createUnchangedPersistStorage<PersistedContextSidebarState>(),
      partialize: (state): PersistedContextSidebarState => ({
        isOpen: state.isOpen,
        view: state.view,
        branchCompareBaseRefs: state.branchCompareBaseRefs,
      }),
      merge: (persisted, current) => {
        const persistedObject = isRecord(persisted) ? persisted : {};
        return {
          ...current,
          isOpen:
            typeof persistedObject.isOpen === "boolean"
              ? persistedObject.isOpen
              : DEFAULT_IS_OPEN,
          view: isContextSidebarView(persistedObject.view)
            ? persistedObject.view
            : DEFAULT_VIEW,
          branchCompareBaseRefs: sanitizeBaseRefs(
            persistedObject.branchCompareBaseRefs,
          ),
        };
      },
    },
  ),
);
