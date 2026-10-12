import { useSidePanelStore } from "@/stores/side-panel-store";
import { getBinaryPreviewLanguage } from "@/lib/file-preview";
import { didOpenFile } from "@/lib/files/open-result";

export async function openFileInSidePanel(
  workspaceId: string,
  path: string,
  fallback: () => void,
  shouldCommit?: () => boolean,
): Promise<boolean> {
  const { setIsLoading, clearError, openFile } = useSidePanelStore.getState();
  const previewLanguage = getBinaryPreviewLanguage(path);
  if (previewLanguage) {
    if (shouldCommit && !shouldCommit()) return false;
    clearError();
    const result = openFile(path, "", previewLanguage, workspaceId);
    useSidePanelStore.getState().setActivePanelTab("files");
    return didOpenFile(result, path);
  }
  setIsLoading(true);
  clearError();
  try {
    const res = await fetch(
      `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
    );
    if (shouldCommit && !shouldCommit()) return false;
    if (!res.ok) {
      fallback();
      return false;
    }
    const data = (await res.json()) as { content: string; language?: string };
    if (shouldCommit && !shouldCommit()) return false;
    const result = openFile(
      path,
      data.content,
      data.language ?? "plaintext",
      workspaceId,
    );
    useSidePanelStore.getState().setActivePanelTab("files");
    return didOpenFile(result, path);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (shouldCommit && !shouldCommit()) return false;
    fallback();
    return false;
  } finally {
    setIsLoading(false);
  }
}
