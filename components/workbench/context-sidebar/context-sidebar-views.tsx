import type { ComponentType } from "react";
import {
  Activity,
  FileDiff,
  FolderTree,
  GitCompare,
  type LucideIcon,
} from "lucide-react";
import { ExplorerView } from "@/components/workbench/context-sidebar/explorer-view";
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

// The order of the desktop rail and of the mobile switcher row.
export const CONTEXT_SIDEBAR_VIEW_ITEMS: readonly ContextSidebarViewItem[] = [
  { view: "explorer", label: "Explorer", icon: FolderTree },
  { view: "changes", label: "Changes", icon: FileDiff },
  { view: "compare", label: "Compare", icon: GitCompare },
  { view: "status", label: "Status", icon: Activity },
];

function ViewPlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
      {label} is not available yet.
    </div>
  );
}

// Placeholders until the Changes, Compare and Status views replace them.
function ChangesPlaceholder() {
  return <ViewPlaceholder label="Changes" />;
}

function ComparePlaceholder() {
  return <ViewPlaceholder label="Compare" />;
}

function StatusPlaceholder() {
  return <ViewPlaceholder label="Status" />;
}

export const CONTEXT_SIDEBAR_VIEW_COMPONENTS: Record<
  ContextSidebarView,
  ComponentType<ContextSidebarViewProps>
> = {
  explorer: ExplorerView,
  changes: ChangesPlaceholder,
  compare: ComparePlaceholder,
  status: StatusPlaceholder,
};
