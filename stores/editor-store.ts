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
import {
  migratePersistedEditorState,
  type DiffViewMode,
  type PersistedEditorState,
  type WorkspaceFileState,
} from "@/lib/files/persisted-editor-state";

let tabInstanceCounter = 0;
let revealCounter = 0;

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

interface EditorState extends ReturnType<typeof createFileContentActions> {
  openFiles: OpenFile[];
  activeFilePath: string | null;
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
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
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
  releaseCleanBuffersOutside: (workspaceId: string) => void;
}

function getWsState(
  states: Record<string, WorkspaceFileState>,
  workspaceId: string,
): WorkspaceFileState {
  return states[workspaceId] ?? { expandedPaths: [] };
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

      // Other workspaces' file tabs left with their layouts, so their clean
      // buffers can go. Dirty ones stay: unsaved edits are never discarded.
      releaseCleanBuffersOutside: (workspaceId) =>
        set((state) => {
          const openFiles = state.openFiles.filter(
            (file) =>
              file.isDirty ||
              resolveTabWorkspaceId(file, workspaceId) === workspaceId,
          );
          if (openFiles.length === state.openFiles.length) return state;
          const isActiveFileOpen = openFiles.some(
            (file) => file.path === state.activeFilePath,
          );
          return {
            openFiles,
            activeFilePath: isActiveFileOpen ? state.activeFilePath : null,
          };
        }),
    }),
    {
      name: "dev-hub-editor",
      version: 1,
      storage: createUnchangedPersistStorage<PersistedEditorState>(),
      partialize: (state): PersistedEditorState => ({
        diffViewMode: state.diffViewMode,
        workspaceFileStates: state.workspaceFileStates,
      }),
      migrate: migratePersistedEditorState,
    },
  ),
);
