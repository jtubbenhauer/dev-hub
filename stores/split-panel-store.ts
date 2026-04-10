import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SplitPanelState {
  isOpen: boolean;
  activeTab: "files";
  currentFilePath: string | null;
  currentFileContent: string | null;
  currentFileLanguage: string | null;
  originalContent: string | null;
  isDirty: boolean;
  isFilePickerOpen: boolean;
  isLoading: boolean;
  error: string | null;
  expandedPaths: string[];

  openFile: (path: string, content: string, language: string) => void;
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

export const useSplitPanelStore = create<SplitPanelState>()(
  persist(
    (set) => ({
      isOpen: false,
      activeTab: "files",
      currentFilePath: null,
      currentFileContent: null,
      currentFileLanguage: null,
      originalContent: null,
      isDirty: false,
      isFilePickerOpen: false,
      isLoading: false,
      error: null,
      expandedPaths: [],

      openFile: (path, content, language) =>
        set({
          isOpen: true,
          currentFilePath: path,
          currentFileContent: content,
          currentFileLanguage: language,
          originalContent: content,
          isDirty: false,
          error: null,
        }),

      closePanel: () => set({ isOpen: false }),

      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      setContent: (content) =>
        set((state) => ({
          currentFileContent: content,
          isDirty: content !== state.originalContent,
        })),

      markSaved: () =>
        set((state) => ({
          originalContent: state.currentFileContent,
          isDirty: false,
        })),

      clearFile: () =>
        set({
          currentFilePath: null,
          currentFileContent: null,
          currentFileLanguage: null,
          originalContent: null,
          isDirty: false,
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
      name: "dev-hub:split-panel",
      partialize: (state) => ({
        isOpen: state.isOpen,
        currentFilePath: state.currentFilePath,
        isFilePickerOpen: state.isFilePickerOpen,
        expandedPaths: state.expandedPaths,
      }),
    },
  ),
);
