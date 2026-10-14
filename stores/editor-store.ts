import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";
import type { OpenFile } from "@/types";
import {
  createFileContentActions,
  getFileOpenResult,
  type OpenFileResult,
} from "@/lib/files/tab-state";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";

let tabInstanceCounter = 0;

export type DiffViewMode = "unified" | "side-by-side";

interface SavedTab {
  path: string;
  name: string;
  language: string;
}

interface WorkspaceFileState {
  tabs: SavedTab[];
  activeFilePath: string | null;
  expandedPaths: string[];
}

interface EditorState extends ReturnType<typeof createFileContentActions> {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  isFileTreeOpen: boolean;
  diffViewMode: DiffViewMode;
  markdownPreviewPath: string | null;
  csvPreviewPath: string | null;
  workspaceFileStates: Record<string, WorkspaceFileState>;

  openFile: (file: OpenFile) => OpenFileResult;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
  toggleFileTree: () => void;
  setFileTreeOpen: (open: boolean) => void;
  toggleDiffViewMode: () => void;
  setDiffViewMode: (mode: DiffViewMode) => void;
  setMarkdownPreviewPath: (path: string | null) => void;
  setCsvPreviewPath: (path: string | null) => void;
  closeAllFiles: () => void;

  getExpandedPaths: (workspaceId: string) => Set<string>;
  toggleExpandedPath: (workspaceId: string, path: string) => void;
  expandPathToFile: (workspaceId: string, filePath: string) => void;
  expandFolder: (workspaceId: string, folderPath: string) => void;
  saveWorkspaceState: (workspaceId: string) => void;
  releaseOtherWorkspaceTabs: (workspaceId: string) => void;
  getSavedTabs: (workspaceId: string) => SavedTab[];
  getSavedActiveFile: (workspaceId: string) => string | null;
}

function getWsState(
  states: Record<string, WorkspaceFileState>,
  workspaceId: string,
): WorkspaceFileState {
  return (
    states[workspaceId] ?? { tabs: [], activeFilePath: null, expandedPaths: [] }
  );
}

function toSavedTab(file: OpenFile): SavedTab {
  return { path: file.path, name: file.name, language: file.language };
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      ...createFileContentActions(get, set),
      openFiles: [],
      activeFilePath: null,
      isFileTreeOpen: true,
      diffViewMode: "unified" as DiffViewMode,
      markdownPreviewPath: null,
      csvPreviewPath: null,
      workspaceFileStates: {},

      openFile: (file) => {
        const existing = get().openFiles.find((f) => f.path === file.path);
        const result = getFileOpenResult(existing, file.workspaceId);
        if (result === "activated" || result === "kept-foreign-dirty") {
          set({ activeFilePath: file.path });
          return result;
        }
        const newFile = { ...file, instanceId: ++tabInstanceCounter };
        set((state) => ({
          openFiles: existing
            ? state.openFiles.map((tab) =>
                tab === existing
                  ? {
                      ...newFile,
                      originalContent: file.content,
                      isDirty: false,
                    }
                  : tab,
              )
            : [...state.openFiles, newFile],
          activeFilePath: file.path,
        }));
        return result;
      },

      closeFile: (path) => {
        const { openFiles, activeFilePath } = get();
        const index = openFiles.findIndex((f) => f.path === path);
        const nextFiles = openFiles.filter((f) => f.path !== path);

        let nextActive = activeFilePath;
        if (activeFilePath === path) {
          if (nextFiles.length === 0) {
            nextActive = null;
          } else if (index >= nextFiles.length) {
            nextActive = nextFiles[nextFiles.length - 1].path;
          } else {
            nextActive = nextFiles[index].path;
          }
        }

        set({ openFiles: nextFiles, activeFilePath: nextActive });
      },

      setActiveFile: (path) => set({ activeFilePath: path }),

      updateFileContent: (path, content) =>
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, content, isDirty: content !== f.originalContent }
              : f,
          ),
        })),

      markFileSaved: (path) =>
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, isDirty: false, originalContent: f.content }
              : f,
          ),
        })),

      toggleFileTree: () =>
        set((state) => ({ isFileTreeOpen: !state.isFileTreeOpen })),
      setFileTreeOpen: (open) => set({ isFileTreeOpen: open }),

      toggleDiffViewMode: () =>
        set((state) => ({
          diffViewMode:
            state.diffViewMode === "unified" ? "side-by-side" : "unified",
        })),
      setDiffViewMode: (mode) => set({ diffViewMode: mode }),

      setMarkdownPreviewPath: (path) => set({ markdownPreviewPath: path }),

      setCsvPreviewPath: (path) => set({ csvPreviewPath: path }),

      closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),

      getExpandedPaths: (workspaceId) => {
        const ws = getWsState(get().workspaceFileStates, workspaceId);
        return new Set(ws.expandedPaths);
      },

      toggleExpandedPath: (workspaceId, path) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId);
          const paths = new Set(ws.expandedPaths);
          if (paths.has(path)) {
            paths.delete(path);
          } else {
            paths.add(path);
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          };
        }),

      expandPathToFile: (workspaceId, filePath) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId);
          const paths = new Set(ws.expandedPaths);
          const segments = filePath.split("/");
          for (let i = 1; i < segments.length; i++) {
            paths.add(segments.slice(0, i).join("/"));
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          };
        }),

      expandFolder: (workspaceId, folderPath) =>
        set((state) => {
          const ws = getWsState(state.workspaceFileStates, workspaceId);
          const paths = new Set(ws.expandedPaths);
          const segments = folderPath.split("/");
          for (let i = 1; i <= segments.length; i++) {
            paths.add(segments.slice(0, i).join("/"));
          }
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: { ...ws, expandedPaths: [...paths] },
            },
          };
        }),

      saveWorkspaceState: (workspaceId) =>
        set((state) => {
          const ownTabs = state.openFiles.filter(
            (f) => resolveTabWorkspaceId(f, workspaceId) === workspaceId,
          );
          const existing = getWsState(state.workspaceFileStates, workspaceId);
          return {
            workspaceFileStates: {
              ...state.workspaceFileStates,
              [workspaceId]: {
                ...existing,
                tabs: ownTabs.map(toSavedTab),
                activeFilePath: ownTabs.some(
                  (f) => f.path === state.activeFilePath,
                )
                  ? state.activeFilePath
                  : null,
              },
            },
          };
        }),

      // Saves other workspaces' tabs for their owners and closes the clean ones.
      // Dirty tabs stay open so unsaved edits are never discarded.
      releaseOtherWorkspaceTabs: (workspaceId) =>
        set((state) => {
          const isOwnTab = (file: OpenFile) =>
            resolveTabWorkspaceId(file, workspaceId) === workspaceId;
          const foreignTabs = state.openFiles.filter((f) => !isOwnTab(f));
          if (foreignTabs.length === 0) return state;

          const workspaceFileStates = { ...state.workspaceFileStates };
          const ownerIds = new Set(
            foreignTabs.map((f) => resolveTabWorkspaceId(f, workspaceId)),
          );
          for (const ownerId of ownerIds) {
            const ownerTabs = foreignTabs.filter(
              (f) => f.workspaceId === ownerId,
            );
            const existing = getWsState(workspaceFileStates, ownerId);
            workspaceFileStates[ownerId] = {
              ...existing,
              tabs: ownerTabs.map(toSavedTab),
              activeFilePath: ownerTabs.some(
                (f) => f.path === state.activeFilePath,
              )
                ? state.activeFilePath
                : existing.activeFilePath,
            };
          }

          const openFiles = state.openFiles.filter(
            (f) => f.isDirty || isOwnTab(f),
          );
          const isActiveStillOpen = openFiles.some(
            (f) => f.path === state.activeFilePath,
          );
          return {
            openFiles,
            workspaceFileStates,
            activeFilePath: isActiveStillOpen
              ? state.activeFilePath
              : (openFiles.find(isOwnTab)?.path ?? null),
          };
        }),

      getSavedTabs: (workspaceId) => {
        return getWsState(get().workspaceFileStates, workspaceId).tabs;
      },

      getSavedActiveFile: (workspaceId) => {
        return getWsState(get().workspaceFileStates, workspaceId)
          .activeFilePath;
      },
    }),
    {
      name: "dev-hub-editor",
      storage: createUnchangedPersistStorage(),
      partialize: (state) => ({
        isFileTreeOpen: state.isFileTreeOpen,
        diffViewMode: state.diffViewMode,
        workspaceFileStates: state.workspaceFileStates,
      }),
    },
  ),
);
