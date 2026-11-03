import { GitTabPanel } from "@/components/chat/git-tab-panel";
import type { ContextSidebarViewProps } from "@/components/workbench/context-sidebar/context-sidebar-views";
import { openDiffInWorkbench } from "@/lib/workbench/open-in-workbench";

export function ChangesView({ workspaceId }: ContextSidebarViewProps) {
  return (
    <GitTabPanel
      workspaceId={workspaceId}
      onSelectFile={({ path, staged }) => {
        openDiffInWorkbench({
          workspaceId,
          path,
          source: staged ? "staged" : "working",
          baseRef: null,
        });
      }}
    />
  );
}
