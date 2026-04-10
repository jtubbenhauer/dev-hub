"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { FileTree } from "@/components/editor/file-tree";
import type { FileTreeEntry } from "@/types";
import { OpenEditors } from "@/components/editor/open-editors";
import { FileTabs } from "@/components/editor/file-tabs";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import type { EditorHandle } from "@/components/editor/editor-switcher";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeaderAction } from "@/hooks/use-leader-action";

import { useFileTabsSetting } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  GripVertical,
  PanelLeftClose,
  PanelLeft,
  Save,
  Loader2,
  FolderOpen,
  FileCode2,
  GitCompare,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGitStatus } from "@/hooks/use-git";

const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 260;

export default function FilesPage() {
  return (
    <Suspense>
      <FilesContent />
    </Suspense>
  );
}

function FilesContent() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const isFileTreeOpen = useEditorStore((s) => s.isFileTreeOpen);
  const toggleFileTree = useEditorStore((s) => s.toggleFileTree);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const markFileSaved = useEditorStore((s) => s.markFileSaved);
  const editorOpenFile = useEditorStore((s) => s.openFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const saveWorkspaceState = useEditorStore((s) => s.saveWorkspaceState);
  const getSavedTabs = useEditorStore((s) => s.getSavedTabs);
  const getSavedActiveFile = useEditorStore((s) => s.getSavedActiveFile);
  const expandPathToFile = useEditorStore((s) => s.expandPathToFile);
  const expandFolder = useEditorStore((s) => s.expandFolder);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const toggleExpandedPath = useEditorStore((s) => s.toggleExpandedPath);
  const workspaceFileStates = useEditorStore((s) => s.workspaceFileStates);

  const { isFileTabsDisabled } = useFileTabsSetting();

  const expandedPaths = useMemo(() => {
    if (!activeWorkspaceId) return new Set<string>();
    const ws = workspaceFileStates[activeWorkspaceId];
    return new Set(ws?.expandedPaths ?? []);
  }, [activeWorkspaceId, workspaceFileStates]);

  const handleToggleExpand = useCallback(
    (path: string) => {
      if (activeWorkspaceId) {
        toggleExpandedPath(activeWorkspaceId, path);
      }
    },
    [activeWorkspaceId, toggleExpandedPath],
  );

  const handleExpandPathToFile = useCallback(
    (path: string) => {
      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, path);
      }
    },
    [activeWorkspaceId, expandPathToFile],
  );

  const handleFileTreeFileClick = useCallback(
    async (entry: FileTreeEntry) => {
      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, entry.path);
      }
      const response = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(entry.path)}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      if (isFileTabsDisabled) closeAllFiles();
      editorOpenFile({
        path: entry.path,
        name: entry.name,
        content: data.content,
        language: data.language,
        isDirty: false,
        originalContent: data.content,
      });
    },
    [
      activeWorkspaceId,
      editorOpenFile,
      closeAllFiles,
      isFileTabsDisabled,
      expandPathToFile,
    ],
  );

  const handleFileTreeSearchResultClick = useCallback(
    async (filePath: string) => {
      const name = filePath.split("/").pop() ?? filePath;
      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, filePath);
      }
      const response = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(filePath)}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      if (isFileTabsDisabled) closeAllFiles();
      editorOpenFile({
        path: filePath,
        name,
        content: data.content,
        language: data.language,
        isDirty: false,
        originalContent: data.content,
      });
    },
    [
      activeWorkspaceId,
      editorOpenFile,
      closeAllFiles,
      isFileTabsDisabled,
      expandPathToFile,
    ],
  );

  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const { data: gitStatus } = useGitStatus(activeWorkspaceId);
  const isActiveFileUnstaged = useMemo(() => {
    if (!gitStatus || !activeFilePath) return false;
    return gitStatus.unstaged.some((f) => f.path === activeFilePath);
  }, [gitStatus, activeFilePath]);
  const [isMobileTreeOpen, setIsMobileTreeOpen] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const restoredForRef = useRef<string | null>(null);
  const openedFromParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || isRestoring || isFileTabsDisabled) return;
    if (restoredForRef.current === activeWorkspaceId) return;

    const savedTabs = getSavedTabs(activeWorkspaceId);
    if (savedTabs.length === 0 || openFiles.length > 0) {
      restoredForRef.current = activeWorkspaceId;
      return;
    }

    restoredForRef.current = activeWorkspaceId;
    setIsRestoring(true);

    const savedActive = getSavedActiveFile(activeWorkspaceId);

    Promise.all(
      savedTabs.map(async (tab) => {
        try {
          const res = await fetch(
            `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(tab.path)}`,
          );
          if (!res.ok) return null;
          const data = await res.json();
          return {
            path: tab.path,
            name: tab.name,
            content: data.content as string,
            language: data.language as string,
            isDirty: false,
            originalContent: data.content as string,
          };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      for (const file of results) {
        if (file) editorOpenFile(file);
      }
      if (savedActive) {
        const restored = results.find((f) => f?.path === savedActive);
        if (restored) setActiveFile(restored.path);
      }
      setIsRestoring(false);
    });
  }, [
    activeWorkspaceId,
    openFiles.length,
    isRestoring,
    isFileTabsDisabled,
    getSavedTabs,
    getSavedActiveFile,
    editorOpenFile,
    setActiveFile,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId || isRestoring) return;
    saveWorkspaceState(activeWorkspaceId);
    // openFiles and activeFilePath must trigger this save even though saveWorkspaceState reads them internally
  }, [
    activeWorkspaceId,
    openFiles,
    activeFilePath,
    isRestoring,
    saveWorkspaceState,
  ]);

  useEffect(() => {
    const openPath = searchParams.get("open");
    if (!openPath || !activeWorkspaceId) return;
    if (openedFromParamRef.current === openPath) return;

    openedFromParamRef.current = openPath;

    expandPathToFile(activeWorkspaceId, openPath);

    const alreadyOpen = openFiles.find((f) => f.path === openPath);
    if (alreadyOpen) {
      if (isFileTabsDisabled) closeAllFiles();
      setActiveFile(openPath);
      return;
    }

    if (isFileTabsDisabled) closeAllFiles();

    fetch(
      `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(openPath)}`,
    )
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const name = openPath.split("/").pop() ?? openPath;
        editorOpenFile({
          path: openPath,
          name,
          content: data.content,
          language: data.language,
          isDirty: false,
          originalContent: data.content,
        });
      })
      .catch(() => {});
  }, [
    searchParams,
    activeWorkspaceId,
    openFiles,
    editorOpenFile,
    setActiveFile,
    expandPathToFile,
    isFileTabsDisabled,
    closeAllFiles,
  ]);

  const expandedFolderRef = useRef<string | null>(null);

  useEffect(() => {
    const folderPath = searchParams.get("expand");
    if (!folderPath || !activeWorkspaceId) return;
    if (expandedFolderRef.current === folderPath) return;

    expandedFolderRef.current = folderPath;
    expandFolder(activeWorkspaceId, folderPath);
  }, [searchParams, activeWorkspaceId, expandFolder]);

  const { width: panelWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    defaultWidth: DEFAULT_PANEL_WIDTH,
    storageKey: "dev-hub:file-tree-width",
  });

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath],
  );

  const handleSave = useCallback(async () => {
    if (!activeFile || !activeWorkspaceId) return;

    setSavingPath(activeFile.path);
    try {
      const res = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          path: activeFile.path,
          content: activeFile.content,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      markFileSaved(activeFile.path);
      toast.success("Saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingPath(null);
    }
  }, [activeFile, activeWorkspaceId, markFileSaved]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const filesLeaderActions = useMemo(
    () => [
      {
        action: {
          id: "files:save",
          label: "Save file",
          page: "files" as const,
        },
        handler: () => void handleSaveRef.current(),
      },
      {
        action: {
          id: "files:focus-search",
          label: "Focus file search",
          page: "files" as const,
        },
        handler: () => searchInputRef.current?.focus(),
      },
      {
        action: {
          id: "files:focus-tree",
          label: "Focus file tree",
          page: "files" as const,
        },
        handler: () => {
          editorHandleRef.current?.blur();
          fileTreeFocusRef.current?.focus();
        },
      },
      {
        action: {
          id: "files:focus-editor",
          label: "Focus editor",
          page: "files" as const,
        },
        handler: () => editorHandleRef.current?.focus(),
      },
    ],
    [],
  );
  useLeaderAction(filesLeaderActions);

  const fileTreeFocusRef = useRef<HTMLDivElement>(null);
  const editorPanelFocusRef = useRef<HTMLDivElement>(null);
  const editorHandleRef = useRef<EditorHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (content: string) => {
      if (activeFilePath) {
        updateFileContent(activeFilePath, content);
      }
    },
    [activeFilePath, updateFileContent],
  );

  if (!activeWorkspace) {
    return (
      <AuthenticatedLayout>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <FolderOpen className="text-muted-foreground/40 h-10 w-10" />
          <p className="text-muted-foreground text-sm">
            Select a workspace to browse files
          </p>
        </div>
      </AuthenticatedLayout>
    );
  }

  const isSaving = savingPath === activeFile?.path;

  return (
    <AuthenticatedLayout>
      <div className="flex h-full min-h-0 min-w-0">
        {/* Mobile file tree sheet */}
        {isMobile && (
          <Sheet open={isMobileTreeOpen} onOpenChange={setIsMobileTreeOpen}>
            <SheetContent side="left" className="w-[300px] p-0">
              <SheetHeader className="border-b px-3 py-2">
                <SheetTitle className="text-sm">Files</SheetTitle>
              </SheetHeader>
              <div className="h-[calc(100%-41px)]">
                {!isFileTabsDisabled && <OpenEditors />}
                <FileTree
                  workspaceId={activeWorkspaceId}
                  expandedPaths={expandedPaths}
                  activeFilePath={activeFilePath}
                  onToggleExpand={handleToggleExpand}
                  onExpandPathToFile={handleExpandPathToFile}
                  onFileClick={handleFileTreeFileClick}
                  onSearchResultClick={handleFileTreeSearchResultClick}
                  searchInputRef={searchInputRef}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Desktop file tree panel */}
        {!isMobile && isFileTreeOpen && (
          <div
            ref={(el) => {
              fileTreeFocusRef.current = el;
            }}
            tabIndex={-1}
            className="relative flex min-h-0 shrink-0 flex-col border-r outline-none"
            style={{ width: panelWidth }}
          >
            <div className="flex shrink-0 items-center justify-between border-b px-2 py-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Explorer
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={toggleFileTree}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            </div>
            {!isFileTabsDisabled && <OpenEditors />}
            <FileTree
              workspaceId={activeWorkspaceId}
              expandedPaths={expandedPaths}
              activeFilePath={activeFilePath}
              onToggleExpand={handleToggleExpand}
              onExpandPathToFile={handleExpandPathToFile}
              onFileClick={handleFileTreeFileClick}
              onSearchResultClick={handleFileTreeSearchResultClick}
              searchInputRef={searchInputRef}
            />
          </div>
        )}

        {/* Drag handle - desktop only */}
        {!isMobile && isFileTreeOpen && (
          <div
            className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
            onMouseDown={handleDragStart}
          >
            <GripVertical className="text-muted-foreground/30 size-3.5" />
          </div>
        )}

        {/* Editor panel (right) */}
        <div
          ref={(el) => {
            editorPanelFocusRef.current = el;
          }}
          tabIndex={-1}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {/* Editor header bar */}
          <div className="bg-muted/30 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
            {/* Toggle file tree button */}
            {!isMobile && !isFileTreeOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={toggleFileTree}
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* Mobile file tree toggle */}
            {isMobile && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setIsMobileTreeOpen(true)}
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* File path breadcrumb */}
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
              {activeFile?.path ?? "No file open"}
            </span>

            {activeFile && isActiveFileUnstaged && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title="Open in git diff"
                onClick={() => {
                  localStorage.setItem(
                    "dev-hub:git-picker-selected-file",
                    activeFile.path,
                  );
                  localStorage.setItem("dev-hub:git-view-mode", "working");
                  router.push("/git");
                  window.dispatchEvent(
                    new CustomEvent("devhub:git-select-file", {
                      detail: { path: activeFile.path, staged: false },
                    }),
                  );
                }}
              >
                <GitCompare className="h-3.5 w-3.5" />
              </Button>
            )}

            {activeFile && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-1.5 text-xs"
                onClick={() => void handleSave()}
                disabled={isSaving || !activeFile.isDirty}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span className="hidden md:inline">Save</span>
              </Button>
            )}
          </div>

          {/* File tabs */}
          {!isFileTabsDisabled && <FileTabs />}

          {/* Editor area */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeFile ? (
              <EditorSwitcher
                ref={editorHandleRef}
                content={activeFile.content}
                language={activeFile.language}
                onChange={handleChange}
                onSave={() => void handleSaveRef.current()}
                workspaceId={activeWorkspaceId ?? undefined}
                filePath={activeFile.path}
              />
            ) : (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
                <FileCode2 className="text-muted-foreground/20 h-12 w-12" />
                <p className="text-sm">
                  {!isFileTabsDisabled && openFiles.length > 0
                    ? "Select a tab to view the file"
                    : "Open a file from the explorer"}
                </p>
                {!isFileTreeOpen && !isMobile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleFileTree}
                    className="gap-1.5"
                  >
                    <PanelLeft className="h-3.5 w-3.5" />
                    Open Explorer
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
