import { create } from "zustand";
import { loadFileForEditor } from "@/lib/files/load-file-for-editor";
import type {
  DiskReplacement,
  FileSaveSnapshot,
  SaveAcknowledgment,
} from "@/lib/files/tab-state";

let tabInstanceCounter = 0;

interface ChatDialogFile {
  readonly instanceId: number;
  readonly path: string;
  readonly content: string;
  readonly language: string;
  readonly workspaceId: string;
}

interface ChatFileDialogState {
  isOpen: boolean;
  isLoading: boolean;
  file: ChatDialogFile | null;
  originalContent: string;
  openFile: (
    workspaceId: string,
    path: string,
    fallback: () => void,
  ) => Promise<void>;
  setContent: (content: string) => void;
  markSaved: () => void;
  markSavedAs: (
    input: FileSaveSnapshot & {
      readonly workspaceId: string;
      readonly instanceId: number;
    },
  ) => SaveAcknowledgment;
  replaceContentFromDisk: (
    workspaceId: string,
    path: string,
    content: string,
  ) => DiskReplacement;
  reset: () => void;
}

const initialState = {
  isOpen: false,
  isLoading: false,
  file: null,
  originalContent: "",
} satisfies Pick<
  ChatFileDialogState,
  "isOpen" | "isLoading" | "file" | "originalContent"
>;

export const useChatFileDialogStore = create<ChatFileDialogState>(
  (set, get) => ({
    ...initialState,
    openFile: async (workspaceId, path, fallback) => {
      set({ isOpen: true, isLoading: true, file: null, originalContent: "" });
      try {
        const loadedFile = await loadFileForEditor(workspaceId, path);
        if (!loadedFile) {
          set(initialState);
          fallback();
          return;
        }
        set({
          file: {
            instanceId: ++tabInstanceCounter,
            path,
            workspaceId,
            ...loadedFile,
          },
          originalContent: loadedFile.content,
        });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        set(initialState);
        fallback();
      } finally {
        set({ isLoading: false });
      }
    },
    setContent: (content) => {
      const file = get().file;
      if (!file) return;
      set({ file: { ...file, content } });
    },
    markSaved: () => {
      const file = get().file;
      if (!file) return;
      set({ originalContent: file.content });
    },
    markSavedAs: (input) => {
      const { file, originalContent } = get();
      if (
        !file ||
        file.workspaceId !== input.workspaceId ||
        file.path !== input.path ||
        file.instanceId !== input.instanceId ||
        originalContent !== input.submittedBase
      )
        return "ignored";
      set({ originalContent: input.savedContent });
      return "acknowledged";
    },
    replaceContentFromDisk: (workspaceId, path, content) => {
      const { file, originalContent } = get();
      if (!file || file.workspaceId !== workspaceId || file.path !== path)
        return "not-open";
      if (file.content !== originalContent) return "dirty-skipped";
      set({ file: { ...file, content }, originalContent: content });
      return "replaced";
    },
    reset: () => set(initialState),
  }),
);
