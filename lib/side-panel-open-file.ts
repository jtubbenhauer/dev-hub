import { useSidePanelStore } from "@/stores/side-panel-store";
import { getBinaryPreviewLanguage } from "@/lib/file-preview";

export async function openFileInSidePanel(
  workspaceId: string,
  path: string,
  fallback: () => void,
  shouldCommit?: () => boolean,
): Promise<void> {
  const { setIsLoading, clearError, openFile } = useSidePanelStore.getState();
  const previewLanguage = getBinaryPreviewLanguage(path);
  if (previewLanguage) {
    if (shouldCommit && !shouldCommit()) return;
    clearError();
    openFile(path, "", previewLanguage);
    useSidePanelStore.getState().setActivePanelTab("files");
    return;
  }
  setIsLoading(true);
  clearError();
  try {
    const res = await fetch(
      `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
    );
    if (shouldCommit && !shouldCommit()) return;
    if (!res.ok) {
      fallback();
      return;
    }
    const data = (await res.json()) as { content: string; language?: string };
    if (shouldCommit && !shouldCommit()) return;
    openFile(path, data.content, data.language ?? "plaintext");
    useSidePanelStore.getState().setActivePanelTab("files");
  } catch {
    if (shouldCommit && !shouldCommit()) return;
    fallback();
  } finally {
    setIsLoading(false);
  }
}
