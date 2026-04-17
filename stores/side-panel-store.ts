import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { OpenFile } from "@/types";

interface SidePanelState {
  isOpen: boolean;
  activeTab: "files";
  activePanelTab: "status" | "files";
  openFiles: OpenFile[];
  activeFilePath: string | null;
  isFilePickerOpen: boolean;
  isLoading: boolean;
  error: string | null;
  expandedPaths: string[];

  openFileInTab: (path: string, content: string, language: string) => void;
  openFile: (path: string, content: string, language: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  setActivePanelTab: (tab: "status" | "files") => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setContent: (content: string) => void;
  markSaved: () => void;
  clearFile: () => void;
  setError: (msg: string) => void;
  clearError: () => void;
  toggleFilePicker: () => void;
  setIsLoading: (loading: boolean) => void;
  toggleExpandedPath: (path: string) => void;
  expandPathToFile: (filePath: string) => void;
}

export const useSidePanelStore = create<SidePanelState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeTab: "files",
      activePanelTab: "status",
      openFiles: [],
      activeFilePath: null,
      isFilePickerOpen: false,
      isLoading: false,
      error: null,
      expandedPaths: [],

      openFileInTab: (path, content, language) => {
        const { openFiles } = get();
        const existing = openFiles.find((f) => f.path === path);
        if (existing) {
          set({
            isOpen: true,
            activeFilePath: path,
            activePanelTab: "files",
            error: null,
          });
          return;
        }
        const name = path.split("/").pop() ?? path;
        const newFile: OpenFile = {
          path,
          name,
          content,
          language,
          isDirty: false,
          originalContent: content,
        };
        set({
          isOpen: true,
          openFiles: [...openFiles, newFile],
          activeFilePath: path,
          activePanelTab: "files",
          error: null,
        });
      },

      openFile: (path, content, language) => {
        get().openFileInTab(path, content, language);
      },

      closeTab: (path) => {
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

      setActiveTab: (path) => set({ activeFilePath: path }),

      setActivePanelTab: (tab) => set({ activePanelTab: tab }),

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
              ? { ...f, originalContent: f.content, isDirty: false }
              : f,
          ),
        })),

      closePanel: () => set({ isOpen: false }),

      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      setContent: (content) => {
        const { activeFilePath } = get();
        if (activeFilePath) {
          get().updateFileContent(activeFilePath, content);
        }
      },

      markSaved: () => {
        const { activeFilePath } = get();
        if (activeFilePath) {
          get().markFileSaved(activeFilePath);
        }
      },

      clearFile: () =>
        set({
          openFiles: [],
          activeFilePath: null,
          error: null,
        }),

      setError: (msg) => set({ error: msg, isLoading: false }),

      clearError: () => set({ error: null }),

      toggleFilePicker: () =>
        set((state) => ({ isFilePickerOpen: !state.isFilePickerOpen })),

      setIsLoading: (loading) => set({ isLoading: loading }),

      toggleExpandedPath: (path) =>
        set((state) => {
          const paths = new Set(state.expandedPaths);
          if (paths.has(path)) {
            paths.delete(path);
          } else {
            paths.add(path);
          }
          return { expandedPaths: [...paths] };
        }),

      expandPathToFile: (filePath) =>
        set((state) => {
          const parts = filePath.split("/");
          const paths = new Set(state.expandedPaths);
          let current = "";
          for (let i = 0; i < parts.length - 1; i++) {
            current = current ? `${current}/${parts[i]}` : parts[i];
            paths.add(current);
          }
          return { expandedPaths: [...paths] };
        }),
    }),
    {
      name: "dev-hub:side-panel",
      partialize: (state) => ({
        isOpen: state.isOpen,
        isFilePickerOpen: state.isFilePickerOpen,
        expandedPaths: state.expandedPaths,
        activePanelTab: state.activePanelTab,
      }),
    },
  ),
);
