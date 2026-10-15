import { useLspEnabledSetting } from "@/hooks/use-settings";
import {
  isLspDocumentPath,
  workspaceRelativePathToFileUri,
} from "@/lib/lsp/document-scope";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useLspCandidateUri({
  workspaceId,
  filePath,
  isLspEligible,
}: {
  readonly workspaceId: string | undefined;
  readonly filePath: string | undefined;
  readonly isLspEligible: boolean | undefined;
}): string | undefined {
  const { isLspEnabled } = useLspEnabledSetting();
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const workspace = useWorkspaceStore(
    (state) =>
      state.workspaces.find((entry) => entry.id === workspaceId) ?? null,
  );
  const candidateUri =
    isLspEligible &&
    isLspEnabled &&
    workspace &&
    workspace.backend === "local" &&
    workspaceId === activeWorkspaceId &&
    filePath &&
    isLspDocumentPath(filePath)
      ? workspaceRelativePathToFileUri(workspace.path, filePath)
      : undefined;
  return candidateUri;
}
