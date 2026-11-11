import { useMemo } from "react";
import { GripVertical } from "lucide-react";
import { LayoutSlotPortal } from "@/components/layout/layout-slots";
import { ContextSidebarContent } from "@/components/workbench/context-sidebar/context-sidebar-content";
import { ContextSidebarMobileSheet } from "@/components/workbench/context-sidebar/context-sidebar-mobile-sheet";
import { ContextSidebarTabs } from "@/components/workbench/context-sidebar/context-sidebar-tabs";
import { useIsWorkbenchMobile } from "@/components/workbench/workbench-mode-context";
import {
  getPullRequestTabAppearance,
  type PullRequestTabAppearance,
} from "@/components/git/workspace-pr/workspace-pr-presentation";
import { useWorkspacePullRequest } from "@/hooks/use-branch-pull-request";
import { useGitStatus } from "@/hooks/use-git";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import {
  useContextSidebarStore,
  type ContextSidebarView,
} from "@/stores/context-sidebar-store";
import type { GitStatusResult, Workspace } from "@/types";

interface ContextSidebarProps {
  readonly workspaceId: string;
  readonly workspace: Workspace;
}

interface ContextSidebarLayoutProps extends ContextSidebarProps {
  readonly changedPathCount: number;
  readonly pullRequestAppearance: PullRequestTabAppearance;
}

function getMaxSidebarWidth(): number {
  return Math.max(600, window.innerWidth * 0.5);
}

// A path that is staged, unstaged and conflicted at once still counts once.
function countChangedPaths(gitStatus: GitStatusResult | undefined): number {
  if (!gitStatus || !gitStatus.isRepo) return 0;
  const paths = new Set<string>();
  for (const file of gitStatus.staged) paths.add(file.path);
  for (const file of gitStatus.unstaged) paths.add(file.path);
  for (const path of gitStatus.untracked) paths.add(path);
  for (const path of gitStatus.conflicted) paths.add(path);
  return paths.size;
}

function toggleView(view: ContextSidebarView): void {
  const contextSidebar = useContextSidebarStore.getState();
  if (contextSidebar.isOpen && contextSidebar.view === view) {
    contextSidebar.setOpen(false);
    return;
  }
  contextSidebar.openView(view);
}

function DesktopContextSidebar({
  workspaceId,
  workspace,
  changedPathCount,
  pullRequestAppearance,
}: ContextSidebarLayoutProps) {
  const isOpen = useContextSidebarStore((state) => state.isOpen);
  const view = useContextSidebarStore((state) => state.view);
  const { width, handleDragStart } = useResizablePanel({
    minWidth: 240,
    maxWidth: getMaxSidebarWidth,
    defaultWidth: 320,
    storageKey: "dev-hub:context-sidebar-width",
    reverse: true,
  });

  if (!isOpen) {
    return (
      <LayoutSlotPortal slot="header-trailing">
        <div className="flex items-center gap-1">
          <div aria-hidden className="bg-border mx-1 h-4 w-px" />
          <ContextSidebarTabs
            shownView={null}
            changedPathCount={changedPathCount}
            pullRequestAppearance={pullRequestAppearance}
            onSelectView={toggleView}
          />
        </div>
      </LayoutSlotPortal>
    );
  }

  return (
    <LayoutSlotPortal slot="right-panel">
      <aside
        aria-label="Context sidebar"
        className="flex h-full min-h-0 shrink-0"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize context sidebar"
          className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
          onMouseDown={handleDragStart}
        >
          <GripVertical className="text-muted-foreground/30 size-3.5" />
        </div>
        <div
          data-testid="context-sidebar-content"
          className="flex h-full min-h-0 shrink-0 flex-col border-l"
          style={{ width }}
        >
          <div className="flex h-12 shrink-0 items-center justify-start border-b px-2">
            <ContextSidebarTabs
              shownView={view}
              changedPathCount={changedPathCount}
              pullRequestAppearance={pullRequestAppearance}
              onSelectView={toggleView}
            />
          </div>
          <ContextSidebarContent
            view={view}
            workspaceId={workspaceId}
            workspace={workspace}
          />
        </div>
      </aside>
    </LayoutSlotPortal>
  );
}

export function ContextSidebar({
  workspaceId,
  workspace,
}: ContextSidebarProps) {
  const isMobile = useIsWorkbenchMobile();
  const { data: gitStatus } = useGitStatus(workspaceId);
  const changedPathCount = useMemo(
    () => countChangedPaths(gitStatus),
    [gitStatus],
  );
  const workspacePullRequest = useWorkspacePullRequest(workspaceId);
  const pullRequestAppearance =
    getPullRequestTabAppearance(workspacePullRequest);

  if (isMobile) {
    return (
      <ContextSidebarMobileSheet
        workspaceId={workspaceId}
        workspace={workspace}
        changedPathCount={changedPathCount}
        pullRequestAppearance={pullRequestAppearance}
      />
    );
  }
  return (
    <DesktopContextSidebar
      workspaceId={workspaceId}
      workspace={workspace}
      changedPathCount={changedPathCount}
      pullRequestAppearance={pullRequestAppearance}
    />
  );
}
