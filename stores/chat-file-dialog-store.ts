import { create } from "zustand";
import { getBinaryPreviewLanguage } from "@/lib/file-preview";
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
  // Set when the file exists but the editor can't display it (binary or too
  // large); the dialog stays open and offers a download instead.
  unsupportedReason: string | null;
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

function isFileContentResponse(
  value: unknown,
): value is { content: string; language?: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("content" in value) || typeof value.content !== "string") return false;
  return !("language" in value) || typeof value.language === "string";
}

function getUnsupportedReason(status: number): string | null {
  if (status === 415) return "This file can't be displayed in the editor.";
  if (status === 413) return "This file is too large to display in the editor.";
  return null;
}

const initialState = {
  isOpen: false,
  isLoading: false,
  file: null,
  originalContent: "",
  unsupportedReason: null,
} satisfies Pick<
  ChatFileDialogState,
  "isOpen" | "isLoading" | "file" | "originalContent" | "unsupportedReason"
>;

export const useChatFileDialogStore = create<ChatFileDialogState>(
  (set, get) => ({
    ...initialState,
    openFile: async (workspaceId, path, fallback) => {
      const previewLanguage = getBinaryPreviewLanguage(path);
      if (previewLanguage) {
        set({
          isOpen: true,
          isLoading: false,
          file: {
            path,
            content: "",
            language: previewLanguage,
            workspaceId,
            instanceId: ++tabInstanceCounter,
          },
          originalContent: "",
          unsupportedReason: null,
        });
        return;
      }
      set({
        isOpen: true,
        isLoading: true,
        file: null,
        originalContent: "",
        unsupportedReason: null,
      });
      try {
        const response = await fetch(
          `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
        );
        if (!response.ok) {
          const unsupportedReason = getUnsupportedReason(response.status);
          if (unsupportedReason !== null) {
            set({
              file: {
                instanceId: ++tabInstanceCounter,
                path,
                content: "",
                language: "plaintext",
                workspaceId,
              },
              unsupportedReason,
            });
            return;
          }
          set(initialState);
          fallback();
          return;
        }

        const data: unknown = await response.json();
        if (!isFileContentResponse(data)) {
          set(initialState);
          fallback();
          return;
        }

        const file = {
          instanceId: ++tabInstanceCounter,
          path,
          content: data.content,
          language: data.language ?? "plaintext",
          workspaceId,
        } satisfies ChatDialogFile;
        set({ file, originalContent: data.content });
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
