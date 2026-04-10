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
}

export const useSplitPanelStore = create<SplitPanelState>()(
  persist(
    (set, get) => ({
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
    }),
    {
      name: "dev-hub:split-panel",
      partialize: (state) => ({
        isOpen: state.isOpen,
        currentFilePath: state.currentFilePath,
        isFilePickerOpen: state.isFilePickerOpen,
      }),
    },
  ),
);
