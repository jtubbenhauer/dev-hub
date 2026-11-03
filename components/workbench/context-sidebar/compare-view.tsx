import { GitBranchComparePanel } from "@/components/chat/git-branch-compare-panel";
import type { ContextSidebarViewProps } from "@/components/workbench/context-sidebar/context-sidebar-views";
import { openDiffInWorkbench } from "@/lib/workbench/open-in-workbench";

export function CompareView({ workspaceId }: ContextSidebarViewProps) {
  return (
    <GitBranchComparePanel
      workspaceId={workspaceId}
      onSelectFile={(path, baseRef) => {
        openDiffInWorkbench({ workspaceId, path, source: "compare", baseRef });
      }}
    />
  );
}
