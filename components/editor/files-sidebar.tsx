"use client";

import { FileTree, type FileTreeProps } from "@/components/editor/file-tree";
import {
  SearchPanel,
  type SearchPanelProps,
} from "@/components/editor/search-panel";
import { useContentSearchStore } from "@/stores/content-search-store";
import { cn } from "@/lib/utils";

interface FilesSidebarProps extends SearchPanelProps {
  readonly fileTreeProps: FileTreeProps;
}

export function FilesSidebar({
  workspaceId,
  fileTreeProps,
  onOpenMatch,
}: FilesSidebarProps) {
  const sidebarView = useContentSearchStore((s) => s.sidebarView);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1">
        <div className="flex items-center gap-3">
          {(["explorer", "search"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={sidebarView === view}
              className={cn(
                "text-[11px] font-medium tracking-wide uppercase",
                sidebarView === view
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() =>
                useContentSearchStore.getState().setSidebarView(view)
              }
            >
              {view === "explorer" ? "Explorer" : "Search"}
            </button>
          ))}
        </div>
      </div>
      {sidebarView === "explorer" ? (
        <FileTree {...fileTreeProps} />
      ) : (
        <SearchPanel workspaceId={workspaceId} onOpenMatch={onOpenMatch} />
      )}
    </div>
  );
}
