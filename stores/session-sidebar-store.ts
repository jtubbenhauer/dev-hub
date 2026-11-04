import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";

const DEFAULT_IS_OPEN = true;

interface PersistedSessionSidebarState {
  isOpen: boolean;
}

interface SessionSidebarState extends PersistedSessionSidebarState {
  // Session-only, so the persisted desktop `isOpen` never opens the sheet.
  isMobileSheetOpen: boolean;

  setOpen: (isOpen: boolean) => void;
  toggle: () => void;
  setMobileSheetOpen: (isMobileSheetOpen: boolean) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const useSessionSidebarStore = create<SessionSidebarState>()(
  persist(
    (set) => ({
      isOpen: DEFAULT_IS_OPEN,
      isMobileSheetOpen: false,

      setOpen: (isOpen) => set({ isOpen }),

      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      setMobileSheetOpen: (isMobileSheetOpen) => set({ isMobileSheetOpen }),
    }),
    {
      name: "dev-hub:session-sidebar",
      version: 1,
      storage: createUnchangedPersistStorage<PersistedSessionSidebarState>(),
      partialize: (state): PersistedSessionSidebarState => ({
        isOpen: state.isOpen,
      }),
      merge: (persisted, current) => {
        const persistedObject = isRecord(persisted) ? persisted : {};
        return {
          ...current,
          isOpen:
            typeof persistedObject.isOpen === "boolean"
              ? persistedObject.isOpen
              : DEFAULT_IS_OPEN,
        };
      },
    },
  ),
);
