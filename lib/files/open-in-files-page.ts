import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { IMAGE_LANGUAGE, isImagePath } from "@/lib/file-preview";

export async function openFileInFilesPage(input: {
  readonly workspaceId: string;
  readonly path: string;
  readonly isFileTabsDisabled: boolean;
  readonly canDiscardDirtyTabs: boolean;
  readonly shouldCommit?: () => boolean;
}): Promise<boolean> {
  let data: unknown;
  if (isImagePath(input.path)) {
    // Images preview from the raw file route, so there is no text to fetch.
    data = { content: "", language: IMAGE_LANGUAGE };
  } else {
    try {
      const response = await fetch(
        `/api/files/content?workspaceId=${encodeURIComponent(input.workspaceId)}&path=${encodeURIComponent(input.path)}`,
      );
      if (!response.ok) return false;
      data = await response.json();
    } catch (error) {
      if (error instanceof Error) return false;
      throw error;
    }
  }
  if (input.shouldCommit && !input.shouldCommit()) return false;
  if (
    typeof data !== "object" ||
    data === null ||
    !("content" in data) ||
    typeof data.content !== "string" ||
    !("language" in data) ||
    typeof data.language !== "string"
  )
    return false;

  const { openFiles, closeAllFiles, closeFile, openFile } =
    useEditorStore.getState();
  if (input.isFileTabsDisabled) {
    if (input.canDiscardDirtyTabs) {
      closeAllFiles();
    } else {
      const others = openFiles.filter((file) => file.path !== input.path);
      if (others.some((file) => file.isDirty)) {
        toast.warning(
          "Save or discard your unsaved changes before opening another file",
        );
        return false;
      }
      for (const file of others) closeFile(file.path);
    }
  }
  openFile({
    path: input.path,
    name: input.path.split("/").pop() ?? input.path,
    content: data.content,
    language: data.language,
    isDirty: false,
    originalContent: data.content,
  });
  return true;
}
