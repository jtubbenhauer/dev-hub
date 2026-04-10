import { useSplitPanelStore } from "@/stores/split-panel-store";

export async function openFileInSplitPanel(
  workspaceId: string,
  path: string,
  fallback: () => void,
): Promise<void> {
  const { setIsLoading, clearError, openFile } = useSplitPanelStore.getState();
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
  } catch {
    fallback();
  } finally {
    setIsLoading(false);
  }
}
