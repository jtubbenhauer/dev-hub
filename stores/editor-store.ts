import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { OpenFile } from "@/types"

export type DiffViewMode = "unified" | "side-by-side"

interface SavedTab {
  path: string
  name: string
  language: string
}

interface WorkspaceFileState {
  tabs: SavedTab[]
  activeFilePath: string | null
  expandedPaths: string[]
}

interface EditorState {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isFileTreeOpen: boolean
  diffViewMode: DiffViewMode
  workspaceFileStates: Record<string, WorkspaceFileState>

  openFile: (file: OpenFile) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  toggleFileTree: () => void
  setFileTreeOpen: (open: boolean) => void
  toggleDiffViewMode: () => void
  setDiffViewMode: (mode: DiffViewMode) => void
  closeAllFiles: () => void

  getExpandedPaths: (workspaceId: string) => Set<string>
  toggleExpandedPath: (workspaceId: string, path: string) => void
  expandPathToFile: (workspaceId: string, filePath: string) => void
  expandFolder: (workspaceId: string, folderPath: string) => void
  saveWorkspaceState: (workspaceId: string) => void
  getSavedTabs: (workspaceId: string) => SavedTab[]
  getSavedActiveFile: (workspaceId: string) => string | null
}

function getWsState(
  states: Record<string, WorkspaceFileState>,
  workspaceId: string
): WorkspaceFileState {
  return states[workspaceId] ?? { tabs: [], activeFilePath: null, expandedPaths: [] }
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      openFiles: [],
      activeFilePath: null,
      isFileTreeOpen: true,
      diffViewMode: "unified" as DiffViewMode,
      workspaceFileStates: {},

      openFile: (file) => {
        const existing = get().openFiles.find((f) => f.path === file.path)
        if (existing) {
          set({ activeFilePath: file.path })
          return
        }
        set((state) => ({
          openFiles: [...state.openFiles, file],
          activeFilePath: file.path,
        }))
      },

      closeFile: (path) => {
        const { openFiles, activeFilePath } = get()
        const index = openFiles.findIndex((f) => f.path === path)
        const nextFiles = openFiles.filter((f) => f.path !== path)

        let nextActive = activeFilePath
        if (activeFilePath === path) {
          if (nextFiles.length === 0) {
            nextActive = null
          } else if (index >= nextFiles.length) {
            nextActive = nextFiles[nextFiles.length - 1].path
          } else {
            nextActive = nextFiles[index].path
          }
        }

        set({ openFiles: nextFiles, activeFilePath: nextActive })
      },

      setActiveFile: (path) => set({ activeFilePath: path }),

      updateFileContent: (path, content) =>
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, content, isDirty: content !== f.originalContent }
              : f
          ),
        })),

      markFileSaved: (path) =>
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, isDirty: false, originalContent: f.content }
              : f
          ),
        })),

      toggleFileTree: () =>
        set((state) => ({ isFileTreeOpen: !state.isFileTreeOpen })),
      setFileTreeOpen: (open) => set({ isFileTreeOpen: open }),

      toggleDiffViewMode: () =>
        set((state) => ({
          diffViewMode: state.diffViewMode === "unified" ? "side-by-side" : "unified",
        })),
      setDiffViewMode: (mode) => set({ diffViewMode: mode }),

      closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),

      getExpandedPaths: (workspaceId) => {
        const ws = getWsState(get().workspaceFileStates, workspaceId)
        return new Set(ws.expandedPaths)
      },

      toggleExpandedPath: (workspaceId, path) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId)
          const paths = new Set(ws.expandedPaths)
          if (paths.has(path)) {
            paths.delete(path)
          } else {
            paths.add(path)
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          }
        }),

      expandPathToFile: (workspaceId, filePath) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId)
          const paths = new Set(ws.expandedPaths)
          const segments = filePath.split("/")
          for (let i = 1; i < segments.length; i++) {
            paths.add(segments.slice(0, i).join("/"))
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          }
        }),

      expandFolder: (workspaceId, folderPath) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId)
          const paths = new Set(ws.expandedPaths)
          const segments = folderPath.split("/")
          for (let i = 1; i <= segments.length; i++) {
            paths.add(segments.slice(0, i).join("/"))
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          }
        }),

      saveWorkspaceState: (workspaceId) =>
        set((state) => {
          const tabs: SavedTab[] = state.openFiles.map((f) => ({
            path: f.path,
            name: f.name,
            language: f.language,
          }))
          const existing = getWsState(state.workspaceFileStates, workspaceId)
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: {
                ...existing,
                tabs,
                activeFilePath: state.activeFilePath,
              },
            },
          }
        }),

      getSavedTabs: (workspaceId) => {
        return getWsState(get().workspaceFileStates, workspaceId).tabs
      },

      getSavedActiveFile: (workspaceId) => {
        return getWsState(get().workspaceFileStates, workspaceId).activeFilePath
      },
    }),
    {
      name: "dev-hub-editor",
      partialize: (state) => ({
        isFileTreeOpen: state.isFileTreeOpen,
        diffViewMode: state.diffViewMode,
        workspaceFileStates: state.workspaceFileStates,
      }),
    }
  )
)
