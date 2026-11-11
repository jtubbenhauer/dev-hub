import type { ComponentType } from "react";
import {
  Activity,
  FileDiff,
  FolderTree,
  GitCompare,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react";
import { ChangesView } from "@/components/workbench/context-sidebar/changes-view";
import { CompareView } from "@/components/workbench/context-sidebar/compare-view";
import { ExplorerView } from "@/components/workbench/context-sidebar/explorer-view";
import { PullRequestView } from "@/components/workbench/context-sidebar/pull-request-view";
import { StatusView } from "@/components/workbench/context-sidebar/status-view";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";
import type { Workspace } from "@/types";

export interface ContextSidebarViewProps {
  readonly workspaceId: string;
  readonly workspace: Workspace;
}

export interface ContextSidebarViewItem {
  readonly view: ContextSidebarView;
  readonly label: string;
  readonly icon: LucideIcon;
}

// The order of the sidebar's view tabs and of the mobile switcher row.
export const CONTEXT_SIDEBAR_VIEW_ITEMS: readonly ContextSidebarViewItem[] = [
  { view: "status", label: "Status", icon: Activity },
  { view: "explorer", label: "Explorer", icon: FolderTree },
  { view: "changes", label: "Changes", icon: FileDiff },
  { view: "compare", label: "Compare", icon: GitCompare },
  { view: "pull-request", label: "PR", icon: GitPullRequest },
];

export const CONTEXT_SIDEBAR_VIEW_COMPONENTS: Record<
  ContextSidebarView,
  ComponentType<ContextSidebarViewProps>
> = {
  explorer: ExplorerView,
  changes: ChangesView,
  compare: CompareView,
  status: StatusView,
  "pull-request": PullRequestView,
};
