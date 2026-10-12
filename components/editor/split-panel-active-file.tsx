import { memo, type ReactNode } from "react";
import { useSidePanelStore } from "@/stores/side-panel-store";
import {
  useFileViewMode,
  type FileViewMode,
} from "@/components/chat/use-file-view-mode";

interface ActiveFileView {
  readonly currentFileContent: string | null;
  readonly isDiff: boolean;
  readonly canDiff: boolean;
  readonly repoRelativeKey: string;
  readonly setMode: (mode: FileViewMode) => void;
}

export const SplitPanelActiveFile = memo(function SplitPanelActiveFile({
  workspaceId,
  workspacePath,
  children,
}: {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly children: (view: ActiveFileView) => ReactNode;
}) {
  const activeFile = useSidePanelStore(
    (state) =>
      state.openFiles.find((file) => file.path === state.activeFilePath) ??
      null,
  );
  const { mode, canDiff, repoRelativeKey, setMode } = useFileViewMode(
    workspaceId,
    workspacePath,
    activeFile,
  );
  return children({
    currentFileContent: activeFile?.content ?? null,
    isDiff: canDiff && mode === "diff",
    canDiff,
    repoRelativeKey,
    setMode,
  });
});
