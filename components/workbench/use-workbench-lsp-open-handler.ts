import { useRouter } from "next/navigation";
import { useLspOpenFileHandler } from "@/hooks/use-lsp-open-file-handler";
import { useFileTabsSetting } from "@/hooks/use-settings";
import { openFileInWorkbench } from "@/lib/workbench/open-in-workbench";
import { useWorkbenchStore } from "@/stores/workbench-store";

function focusedFileTabPath(workspaceId: string | null): string | null {
  const { focusedPanel } = useWorkbenchStore.getState();
  if (focusedPanel === null || focusedPanel.workspaceId !== workspaceId) {
    return null;
  }
  return focusedPanel.params.kind === "file" ? focusedPanel.params.path : null;
}

// Go-to-definition from a file tab editor opens the target as a file tab; the
// navigation counts as done once that tab is the focused one.
export function useWorkbenchLspOpenHandler(workspaceId: string | null): void {
  const router = useRouter();
  const { isFileTabsDisabled } = useFileTabsSetting();
  useLspOpenFileHandler(
    "files-page",
    async (relativePath, shouldCommit) => {
      if (workspaceId === null) return false;
      return openFileInWorkbench({
        workspaceId,
        path: relativePath,
        isFileTabsDisabled,
        shouldCommit,
        navigate: (href) => router.push(href),
      });
    },
    () => focusedFileTabPath(workspaceId),
  );
}
