import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { FilesSidebar } from "@/components/editor/files-sidebar";
import type { ContextSidebarViewProps } from "@/components/workbench/context-sidebar/context-sidebar-views";
import { useIsWorkbenchMobile } from "@/components/workbench/workbench-mode-context";
import { useFilesSearchNavigation } from "@/hooks/use-files-search-navigation";
import { useFileTabsSetting } from "@/hooks/use-settings";
import { openFileInWorkbench } from "@/lib/workbench/open-in-workbench";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import type { FileTreeEntry } from "@/types";

export function ExplorerView({ workspaceId }: ContextSidebarViewProps) {
  const router = useRouter();
  const isMobile = useIsWorkbenchMobile();
  const { isFileTabsDisabled } = useFileTabsSetting();
  const { handleOpenMatch } = useFilesSearchNavigation({
    workspaceId,
    isFileTabsDisabled,
    isMobile,
  });
  const activeFilePath = useEditorStore((state) => state.activeFilePath);
  const savedExpandedPaths = useEditorStore(
    (state) => state.workspaceFileStates[workspaceId]?.expandedPaths,
  );
  const expandedPaths = useMemo(
    () => new Set(savedExpandedPaths ?? []),
    [savedExpandedPaths],
  );
  const focusRequest = useContextSidebarStore((state) => state.focusRequest);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    // Taking it from the store keeps a replayed effect from focusing twice.
    const focusTarget = useContextSidebarStore.getState().consumeFocusRequest();
    switch (focusTarget) {
      case "tree":
        treeContainerRef.current?.focus();
        return;
      case "file-search":
        searchInputRef.current?.focus();
        return;
      case null:
        return;
      default: {
        const unhandledTarget: never = focusTarget;
        throw new Error(`Unhandled focus target: ${String(unhandledTarget)}`);
      }
    }
  }, [focusRequest]);

  const handleToggleExpand = useCallback(
    (path: string) =>
      useEditorStore.getState().toggleExpandedPath(workspaceId, path),
    [workspaceId],
  );

  const handleExpandPathToFile = useCallback(
    (path: string) =>
      useEditorStore.getState().expandPathToFile(workspaceId, path),
    [workspaceId],
  );

  const openFile = useCallback(
    (path: string) => {
      useEditorStore.getState().expandPathToFile(workspaceId, path);
      void openFileInWorkbench({
        workspaceId,
        path,
        isFileTabsDisabled,
        navigate: (href) => router.push(href),
      });
    },
    [workspaceId, isFileTabsDisabled, router],
  );

  const handleFileClick = useCallback(
    (entry: FileTreeEntry) => openFile(entry.path),
    [openFile],
  );

  return (
    <div
      ref={treeContainerRef}
      role="region"
      aria-label="File explorer"
      tabIndex={-1}
      className="focus-visible:ring-ring/50 flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-inset"
    >
      <FilesSidebar
        workspaceId={workspaceId}
        onOpenMatch={handleOpenMatch}
        fileTreeProps={{
          workspaceId,
          expandedPaths,
          activeFilePath,
          onToggleExpand: handleToggleExpand,
          onExpandPathToFile: handleExpandPathToFile,
          onFileClick: handleFileClick,
          onSearchResultClick: openFile,
          searchInputRef,
        }}
      />
    </div>
  );
}
