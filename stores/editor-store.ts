import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { OpenFile } from "@/types"

export type DiffViewMode = "unified" | "side-by-side"

interface EditorState {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isVimMode: boolean
  isFileTreeOpen: boolean
  diffViewMode: DiffViewMode

  openFile: (file: OpenFile) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  toggleVimMode: () => void
  setVimMode: (enabled: boolean) => void
  toggleFileTree: () => void
  setFileTreeOpen: (open: boolean) => void
  toggleDiffViewMode: () => void
  setDiffViewMode: (mode: DiffViewMode) => void
  closeAllFiles: () => void
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      openFiles: [],
      activeFilePath: null,
      isVimMode: false,
      isFileTreeOpen: true,
      diffViewMode: "unified" as DiffViewMode,

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

      toggleVimMode: () => set((state) => ({ isVimMode: !state.isVimMode })),
      setVimMode: (enabled) => set({ isVimMode: enabled }),

      toggleFileTree: () =>
        set((state) => ({ isFileTreeOpen: !state.isFileTreeOpen })),
      setFileTreeOpen: (open) => set({ isFileTreeOpen: open }),

      toggleDiffViewMode: () =>
        set((state) => ({
          diffViewMode: state.diffViewMode === "unified" ? "side-by-side" : "unified",
        })),
      setDiffViewMode: (mode) => set({ diffViewMode: mode }),

      closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),
    }),
    {
      name: "dev-hub-editor",
      partialize: (state) => ({
        isVimMode: state.isVimMode,
        isFileTreeOpen: state.isFileTreeOpen,
        diffViewMode: state.diffViewMode,
      }),
    }
  )
)
