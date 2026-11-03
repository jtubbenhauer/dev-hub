import { CONTEXT_SIDEBAR_VIEW_COMPONENTS } from "@/components/workbench/context-sidebar/context-sidebar-views";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";
import type { Workspace } from "@/types";

interface ContextSidebarContentProps {
  readonly view: ContextSidebarView;
  readonly workspaceId: string;
  readonly workspace: Workspace;
}

export function ContextSidebarContent({
  view,
  workspaceId,
  workspace,
}: ContextSidebarContentProps) {
  const ViewComponent = CONTEXT_SIDEBAR_VIEW_COMPONENTS[view];
  // Keyed by workspace so a switch never shows the previous workspace's state.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ViewComponent
        key={workspaceId}
        workspaceId={workspaceId}
        workspace={workspace}
      />
    </div>
  );
}
