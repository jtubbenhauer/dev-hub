import { useGitStatus } from "@/hooks/use-git";
import { fileViewKey } from "@/lib/workspace-paths";
import { useEditorStore, type FileViewMode } from "@/stores/editor-store";

export interface FileTabViewMode {
  // Git lists the file as unstaged or staged, so there is a diff to show.
  readonly canDiff: boolean;
  readonly mode: FileViewMode;
  readonly isDiffShown: boolean;
  // Only staged changes exist, so the diff compares the index with HEAD.
  readonly isStagedDiff: boolean;
  readonly setMode: (mode: FileViewMode) => void;
}

export function useFileTabViewMode(
  workspaceId: string,
  path: string,
): FileTabViewMode {
  const { data: gitStatus } = useGitStatus(workspaceId);
  const hasUnstagedChange =
    gitStatus?.unstaged.some((file) => file.path === path) ?? false;
  const hasStagedChange =
    gitStatus?.staged.some((file) => file.path === path) ?? false;
  const viewModeKey = fileViewKey(workspaceId, path);
  const mode =
    useEditorStore((state) => state.fileViewModes[viewModeKey]) ?? "editor";
  const canDiff = hasUnstagedChange || hasStagedChange;
  return {
    canDiff,
    mode,
    isDiffShown: canDiff && mode === "diff",
    isStagedDiff: hasStagedChange && !hasUnstagedChange,
    setMode: (nextMode) =>
      useEditorStore.getState().setFileViewMode(viewModeKey, nextMode),
  };
}
