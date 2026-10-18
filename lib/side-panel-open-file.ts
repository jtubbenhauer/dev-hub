import { useSidePanelStore } from "@/stores/side-panel-store";
import { loadFileForEditor } from "@/lib/files/load-file-for-editor";
import { didOpenFile } from "@/lib/files/open-result";

export async function openFileInSidePanel(
  workspaceId: string,
  path: string,
  fallback: () => void,
  shouldCommit?: () => boolean,
): Promise<boolean> {
  const { setIsLoading, clearError, openFile } = useSidePanelStore.getState();
  setIsLoading(true);
  clearError();
  try {
    const loadedFile = await loadFileForEditor(workspaceId, path);
    if (shouldCommit && !shouldCommit()) return false;
    if (!loadedFile) {
      fallback();
      return false;
    }
    const result = openFile(
      path,
      loadedFile.content,
      loadedFile.language,
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
