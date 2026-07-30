import { create } from "zustand";

interface ChatDialogFile {
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
  reset: () => void;
}

function isFileContentResponse(
  value: unknown,
): value is { content: string; language?: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("content" in value) || typeof value.content !== "string") return false;
  return !("language" in value) || typeof value.language === "string";
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
        const response = await fetch(
          `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
        );
        if (!response.ok) {
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
    reset: () => set(initialState),
  }),
);
