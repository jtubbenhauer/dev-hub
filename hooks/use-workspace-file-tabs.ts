import { useEffect, useRef, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/stores/editor-store";
import { loadFileForEditor } from "@/lib/files/load-file-for-editor";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import { didOpenFile } from "@/lib/files/open-result";

// Keeps the files page's tabs per workspace: hands tabs left over from another
// workspace back to it, restores the active workspace's saved tabs, and saves
// them as they change. Resolves the returned promise once the restore is done.
export function useWorkspaceFileTabs(
  activeWorkspaceId: string | null,
  isFileTabsDisabled: boolean,
): RefObject<Promise<void> | null> {
  const tabPaths = useEditorStore(
    useShallow((s) => s.openFiles.map((file) => file.path)),
  );
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const editorOpenFile = useEditorStore((s) => s.openFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const saveWorkspaceState = useEditorStore((s) => s.saveWorkspaceState);
  const releaseOtherWorkspaceTabs = useEditorStore(
    (s) => s.releaseOtherWorkspaceTabs,
  );
  const getSavedTabs = useEditorStore((s) => s.getSavedTabs);
  const getSavedActiveFile = useEditorStore((s) => s.getSavedActiveFile);

  const restoredForRef = useRef<string | null>(null);
  const restoreDoneForRef = useRef<string | null>(null);
  const restoreRunRef = useRef(0);
  const restoreTabsPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const workspaceId = activeWorkspaceId;
    // Open tabs outlive page changes and workspace switches, so hand any
    // left over from another workspace back to it first.
    releaseOtherWorkspaceTabs(workspaceId);
    if (isFileTabsDisabled) {
      restoreRunRef.current += 1;
      restoreDoneForRef.current = workspaceId;
      return;
    }
    if (restoredForRef.current === workspaceId) return;
    restoredForRef.current = workspaceId;
    restoreRunRef.current += 1;
    const restoreRun = restoreRunRef.current;

    const openOwnPaths = new Set(
      useEditorStore
        .getState()
        .openFiles.filter(
          (file) => resolveTabWorkspaceId(file, workspaceId) === workspaceId,
        )
        .map((file) => file.path),
    );
    const tabsToRestore = getSavedTabs(workspaceId).filter(
      (tab) => !openOwnPaths.has(tab.path),
    );
    if (tabsToRestore.length === 0) {
      restoreDoneForRef.current = workspaceId;
      return;
    }

    restoreDoneForRef.current = null;

    const savedActive = getSavedActiveFile(workspaceId);

    restoreTabsPromiseRef.current = Promise.all(
      tabsToRestore.map(async (tab) => {
        try {
          const file = await loadFileForEditor(workspaceId, tab.path);
          if (!file) return null;
          return {
            workspaceId,
            path: tab.path,
            name: tab.name,
            content: file.content,
            language: file.language,
            isDirty: false,
            originalContent: file.content,
          };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      // A later workspace switch owns the tabs now.
      if (restoreRunRef.current !== restoreRun) return;
      restoreDoneForRef.current = workspaceId;
      for (const file of results) {
        if (file) didOpenFile(editorOpenFile(file), file.path);
      }
      if (savedActive) {
        const restored = results.find((f) => f?.path === savedActive);
        if (restored) setActiveFile(restored.path);
      }
    });
  }, [
    activeWorkspaceId,
    isFileTabsDisabled,
    releaseOtherWorkspaceTabs,
    getSavedTabs,
    getSavedActiveFile,
    editorOpenFile,
    setActiveFile,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    // Saving before this workspace's tabs are back would overwrite them.
    if (restoreDoneForRef.current !== activeWorkspaceId) return;
    saveWorkspaceState(activeWorkspaceId);
  }, [activeWorkspaceId, tabPaths, activeFilePath, saveWorkspaceState]);

  return restoreTabsPromiseRef;
}
