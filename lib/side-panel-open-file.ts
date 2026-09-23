import { useSidePanelStore } from "@/stores/side-panel-store";
import { isPdfPath, PDF_LANGUAGE } from "@/lib/file-preview";

export async function openFileInSidePanel(
  workspaceId: string,
  path: string,
  fallback: () => void,
): Promise<void> {
  const { setIsLoading, clearError, openFile } = useSidePanelStore.getState();
  if (isPdfPath(path)) {
    clearError();
    openFile(path, "", PDF_LANGUAGE);
    useSidePanelStore.getState().setActivePanelTab("files");
    return;
  }
  setIsLoading(true);
  clearError();
  try {
    const res = await fetch(
      `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) {
      fallback();
      return;
    }
    const data = (await res.json()) as { content: string; language?: string };
    openFile(path, data.content, data.language ?? "plaintext");
    useSidePanelStore.getState().setActivePanelTab("files");
  } catch {
    fallback();
  } finally {
    setIsLoading(false);
  }
}
