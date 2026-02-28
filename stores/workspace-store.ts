import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Workspace } from "@/types"

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeWorkspace: Workspace | null
  setWorkspaces: (workspaces: Workspace[]) => void
  setActiveWorkspaceId: (id: string | null) => void
  addWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      get activeWorkspace() {
        const state = get()
        return (
          state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null
        )
      },
      setWorkspaces: (workspaces) => set({ workspaces }),
      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
      addWorkspace: (workspace) =>
        set((state) => ({ workspaces: [...state.workspaces, workspace] })),
      removeWorkspace: (id) =>
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId:
            state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
        })),
      updateWorkspace: (id, updates) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, ...updates } : w
          ),
        })),
    }),
    { name: "dev-hub-workspace" }
  )
)
