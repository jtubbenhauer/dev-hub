import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { IMAGE_LANGUAGE, isImagePath } from "@/lib/file-preview";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import { didOpenFile } from "@/lib/files/open-result";

export async function openFileInFilesPage(input: {
  readonly workspaceId: string;
  readonly path: string;
  readonly isFileTabsDisabled: boolean;
  readonly shouldCommit?: () => boolean;
}): Promise<boolean> {
  const refuseForeignDirtyTab = () => {
    const tab = useEditorStore
      .getState()
      .openFiles.find((file) => file.path === input.path);
    if (
      !tab?.isDirty ||
      resolveTabWorkspaceId(tab, input.workspaceId) === input.workspaceId
    )
      return false;
    if (!input.shouldCommit || input.shouldCommit())
      useEditorStore.getState().setActiveFile(input.path);
    didOpenFile("kept-foreign-dirty", input.path);
    return true;
  };
  if (refuseForeignDirtyTab()) return false;
  const existing = useEditorStore
    .getState()
    .openFiles.find(
      (file) =>
        file.path === input.path &&
        resolveTabWorkspaceId(file, input.workspaceId) === input.workspaceId,
    );
  let data: unknown = existing;
  if (!existing && isImagePath(input.path)) {
    // Images preview from the raw file route, so there is no text to fetch.
    data = { content: "", language: IMAGE_LANGUAGE };
  } else if (!existing) {
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
  if (!existing && refuseForeignDirtyTab()) return false;
  if (
    typeof data !== "object" ||
    data === null ||
    !("content" in data) ||
    typeof data.content !== "string" ||
    !("language" in data) ||
    typeof data.language !== "string"
  )
    return false;

  if (input.isFileTabsDisabled) {
    const others = useEditorStore
      .getState()
      .openFiles.filter((file) => file.path !== input.path);
    if (others.some((file) => file.isDirty)) {
      toast.warning(
        "Save or discard your unsaved changes before opening another file",
      );
      return false;
    }
    for (const file of others) useEditorStore.getState().closeFile(file.path);
  }
  const current = useEditorStore
    .getState()
    .openFiles.find(
      (file) =>
        file.path === input.path &&
        resolveTabWorkspaceId(file, input.workspaceId) === input.workspaceId,
    );
  if (current) {
    useEditorStore.getState().setActiveFile(input.path);
    return true;
  }
  const result = useEditorStore.getState().openFile({
    workspaceId: input.workspaceId,
    path: input.path,
    name: input.path.split("/").pop() ?? input.path,
    content: data.content,
    language: data.language,
    isDirty: false,
    originalContent: data.content,
  });
  return didOpenFile(result, input.path);
}
