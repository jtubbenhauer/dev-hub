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
import { findOwnFileBuffer } from "@/lib/files/own-file-buffer";

let tabInstanceCounter = 0;
let revealCounter = 0;

export type DiffViewMode = "unified" | "side-by-side";

export interface EditorRevealRequest {
  readonly id: number;
  readonly workspaceId: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly startByteColumn: number;
  readonly lineSha256: string;
}

export type CleanTabRefresh =
  | "replaced"
  | "unchanged"
  | "dirty-skipped"
  | "not-open";

export type FileViewMode = "editor" | "diff";

export type FileDiskReload =
  | "reloaded"
  | "unchanged"
  | "dirty-skipped"
  | "not-open"
  | "fetch-failed";

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
  pendingReveal: EditorRevealRequest | null;
  // Keyed `${workspaceId}:${path}`; session-only, never persisted.
  fileViewModes: Record<string, FileViewMode>;

  openFile: (file: OpenFile) => OpenFileResult;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  cycleActiveFile: (direction: "next" | "previous") => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
  toggleFileTree: () => void;
  setFileTreeOpen: (open: boolean) => void;
  toggleDiffViewMode: () => void;
  setDiffViewMode: (mode: DiffViewMode) => void;
  setMarkdownPreviewPath: (path: string | null) => void;
  setCsvPreviewPath: (path: string | null) => void;
  closeAllFiles: () => void;

  requestReveal: (input: Omit<EditorRevealRequest, "id">) => void;
  clearReveal: (id: number) => void;
  refreshCleanTabFromDisk: (
    workspaceId: string,
    path: string,
    content: string,
  ) => CleanTabRefresh;
  setFileViewMode: (key: string, mode: FileViewMode) => void;
  reloadFileFromDisk: (
    workspaceId: string,
    path: string,
  ) => Promise<FileDiskReload>;

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

// Keys are `${workspaceId}:${path}`; workspace ids never contain a colon.
function withoutViewModesOfPath(
  fileViewModes: Record<string, FileViewMode>,
  path: string,
): Record<string, FileViewMode> {
  const keysOfPath = Object.keys(fileViewModes).filter(
    (key) => key.slice(key.indexOf(":") + 1) === path,
  );
  if (keysOfPath.length === 0) return fileViewModes;
  const remaining = { ...fileViewModes };
  for (const key of keysOfPath) delete remaining[key];
  return remaining;
}

function isFileContentBody(
  value: unknown,
): value is { readonly content: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    typeof value.content === "string"
  );
}

// Null when the file can't be read (missing, refused, malformed reply).
async function fetchDiskContent(
  workspaceId: string,
  path: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/files/content?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`,
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isFileContentBody(body) ? body.content : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
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
      pendingReveal: null,
      fileViewModes: {},

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

        set({
          openFiles: nextFiles,
          activeFilePath: nextActive,
          fileViewModes: withoutViewModesOfPath(get().fileViewModes, path),
        });
      },

      setActiveFile: (path) => set({ activeFilePath: path }),

      // Wraps around the tab list. Without an active tab, "next" lands on the
      // first tab and "previous" on the last.
      cycleActiveFile: (direction) => {
        const { openFiles, activeFilePath } = get();
        if (openFiles.length === 0) return;
        const step = direction === "next" ? 1 : -1;
        const activeIndex = openFiles.findIndex(
          (f) => f.path === activeFilePath,
        );
        const fromIndex = activeIndex === -1 && step === -1 ? 0 : activeIndex;
        const nextIndex =
          (fromIndex + step + openFiles.length) % openFiles.length;
        set({ activeFilePath: openFiles[nextIndex].path });
      },

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

      requestReveal: (input) =>
        set({ pendingReveal: { ...input, id: ++revealCounter } }),

      clearReveal: (id) => {
        if (get().pendingReveal?.id === id) set({ pendingReveal: null });
      },

      // Unlike replaceFileContentFromDisk, a legacy tab without a workspaceId
      // counts as the given workspace's and is adopted by it.
      refreshCleanTabFromDisk: (workspaceId, path, content) => {
        const { openFiles } = get();
        const tab = openFiles.find(
          (f) =>
            f.path === path &&
            resolveTabWorkspaceId(f, workspaceId) === workspaceId,
        );
        if (!tab) return "not-open";
        if (tab.isDirty) return "dirty-skipped";
        if (
          tab.content === content &&
          tab.originalContent === content &&
          tab.workspaceId === workspaceId
        )
          return "unchanged";
        set({
          openFiles: openFiles.map((f) =>
            f === tab
              ? {
                  ...f,
                  content,
                  originalContent: content,
                  isDirty: false,
                  workspaceId,
                }
              : f,
          ),
        });
        return "replaced";
      },

      setFileViewMode: (key, mode) =>
        set((state) => ({
          fileViewModes: { ...state.fileViewModes, [key]: mode },
        })),

      // Re-checks after the read: edits typed meanwhile are never overwritten.
      reloadFileFromDisk: async (workspaceId, path) => {
        const buffer = findOwnFileBuffer(get().openFiles, workspaceId, path);
        if (!buffer) return "not-open";
        if (buffer.isDirty) return "dirty-skipped";
        const content = await fetchDiskContent(workspaceId, path);
        if (content === null) return "fetch-failed";
        const refresh = get().refreshCleanTabFromDisk(
          workspaceId,
          path,
          content,
        );
        return refresh === "replaced" ? "reloaded" : refresh;
      },

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
