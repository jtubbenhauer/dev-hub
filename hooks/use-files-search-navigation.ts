import { useCallback, useRef, useState } from "react";
import { isSearchMatchCurrent, type ContentSearchMatch } from "@devhub/shared";
import { toast } from "sonner";
import { isBinaryPreviewLanguage } from "@/lib/file-preview";
import { openFileInFilesPage } from "@/lib/files/open-in-files-page";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useFilesSearchNavigation(input: {
  readonly workspaceId: string | null;
  readonly isFileTabsDisabled: boolean;
  readonly isMobile: boolean;
}) {
  const { workspaceId, isFileTabsDisabled, isMobile } = input;
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const pendingFocus = useContentSearchStore((s) => s.pendingFocus);
  const [prevPendingFocus, setPrevPendingFocus] = useState(false);
  if (pendingFocus !== prevPendingFocus) {
    setPrevPendingFocus(pendingFocus);
    if (pendingFocus && isMobile) setIsMobileSheetOpen(true);
  }
  const navigationTokenRef = useRef(0);

  const handleOpenMatch = useCallback(
    async (path: string, match: ContentSearchMatch) => {
      if (!workspaceId) return;
      const token = ++navigationTokenRef.current;
      const isCurrent = () =>
        token === navigationTokenRef.current &&
        useWorkspaceStore.getState().activeWorkspaceId === workspaceId;
      const state = useEditorStore.getState();
      if (state.markdownPreviewPath === path)
        state.setMarkdownPreviewPath(null);
      if (state.csvPreviewPath === path) state.setCsvPreviewPath(null);
      state.expandPathToFile(workspaceId, path);

      const isOpened = await openFileInFilesPage({
        workspaceId,
        path,
        isFileTabsDisabled,
        shouldCommit: isCurrent,
      });
      if (!isOpened || !isCurrent()) return;
      const getTab = () =>
        useEditorStore
          .getState()
          .openFiles.find(
            (file) =>
              file.path === path &&
              resolveTabWorkspaceId(file, workspaceId) === workspaceId,
          );
      const tab = getTab();
      if (!tab || isBinaryPreviewLanguage(tab.language)) return;
      const warnDirty = () =>
        toast.warning(
          `${tab.name} has unsaved changes, so the search match can't be selected. Save the file and search again.`,
        );
      if (tab.isDirty) {
        warnDirty();
        return;
      }

      const response = await fetch(
        `/api/files/content?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`,
      ).catch(() => null);
      if (!isCurrent()) return;
      const body: unknown = response?.ok
        ? await response.json().catch(() => null)
        : null;
      if (!isCurrent()) return;
      if (
        typeof body !== "object" ||
        body === null ||
        !("content" in body) ||
        typeof body.content !== "string"
      ) {
        toast.error(
          `Couldn't re-read ${tab.name} to check the search match. Try again.`,
        );
        return;
      }
      const refresh = useEditorStore
        .getState()
        .refreshCleanTabFromDisk(workspaceId, path, body.content);
      switch (refresh) {
        case "dirty-skipped":
          warnDirty();
          return;
        case "not-open":
          return;
        case "replaced":
        case "unchanged":
          break;
        default: {
          const exhaustive: never = refresh;
          return exhaustive;
        }
      }
      const refreshedTab = getTab();
      if (!refreshedTab) return;
      if (!isSearchMatchCurrent(refreshedTab.content, match)) {
        toast.info(
          `${refreshedTab.name} changed since the search ran. Search again to update the results.`,
        );
        return;
      }
      useEditorStore.getState().requestReveal({
        workspaceId,
        path,
        lineNumber: match.lineNumber,
        startColumn: match.startColumn,
        endColumn: match.endColumn,
        startByteColumn: match.startByteColumn,
        lineSha256: match.lineSha256,
      });
      if (isMobile) setIsMobileSheetOpen(false);
    },
    [workspaceId, isFileTabsDisabled, isMobile],
  );

  return { handleOpenMatch, isMobileSheetOpen, setIsMobileSheetOpen };
}
