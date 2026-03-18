import { create } from "zustand"
import { persist } from "zustand/middleware"

interface TerminalState {
  isOpen: boolean
  setOpen: (open: boolean) => void
  toggle: () => void

  workspaceId: string | null
  setWorkspaceId: (id: string | null) => void
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),

      workspaceId: null,
      setWorkspaceId: (id) => set({ workspaceId: id }),
    }),
    {
      name: "dev-hub-terminal",
      partialize: (state) => ({ workspaceId: state.workspaceId }),
    }
  )
)
