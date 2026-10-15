"use client";
// allow: SIZE_OK — Todo 14 caps this page at 648 lines and forbids moving unrelated logic.

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorTabMetadataSelector } from "@/hooks/use-editor-tab-metadata";
import { useSearchParams } from "next/navigation";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { FilesSidebar } from "@/components/editor/files-sidebar";
import type { FileTreeEntry } from "@/types";
import { FileTabs } from "@/components/editor/file-tabs";
import { FilesActiveEditor } from "@/components/editor/files-active-editor";
import { FileDiagnosticCounts } from "@/components/editor/file-diagnostic-counts";
import { MarkdownPreviewToggle } from "@/components/editor/markdown-preview";
import { CsvPreviewToggle } from "@/components/editor/csv-preview";
import { ImageViewer } from "@/components/editor/image-viewer";
import type { EditorHandle } from "@/components/editor/editor-switcher";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useFilesSearchNavigation } from "@/hooks/use-files-search-navigation";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeaderAction } from "@/hooks/use-leader-action";
import { downloadTextFile } from "@/lib/download-file";
import {
  getRawFileUrl,
  IMAGE_LANGUAGE,
  isBinaryPreviewLanguage,
} from "@/lib/file-preview";

import { useFileTabsSetting, useLspEnabledSetting } from "@/hooks/use-settings";
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
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGitStatus } from "@/hooks/use-git";
import { useLintOnSave } from "@/hooks/use-diagnostics";
import { ProblemsPanel } from "@/components/editor/problems-panel";
import { LspStatusToggle } from "@/components/editor/lsp-status-toggle";
import { useLspOpenFileHandler } from "@/hooks/use-lsp-open-file-handler";
import { useWorkspaceFileTabs } from "@/hooks/use-workspace-file-tabs";
import { openFileInFilesPage } from "@/lib/files/open-in-files-page";
import {
  buildFileSaveBody,
  resolveTabWorkspaceId,
} from "@/lib/files/save-request";
import { completeFileSave } from "@/lib/files/save-completion";
import { submitFileSave } from "@/lib/files/submit-file-save";

const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = () => Math.max(500, window.innerWidth * 0.5);
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

  const openFiles = useEditorStore(useEditorTabMetadataSelector());
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const isFileTreeOpen = useEditorStore((s) => s.isFileTreeOpen);
  const toggleFileTree = useEditorStore((s) => s.toggleFileTree);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const expandPathToFile = useEditorStore((s) => s.expandPathToFile);
  const expandFolder = useEditorStore((s) => s.expandFolder);
  const toggleExpandedPath = useEditorStore((s) => s.toggleExpandedPath);
  const savedExpandedPaths = useEditorStore((s) =>
    activeWorkspaceId
      ? s.workspaceFileStates[activeWorkspaceId]?.expandedPaths
      : undefined,
  );

  const { isFileTabsDisabled } = useFileTabsSetting();
  const { isLspEnabled } = useLspEnabledSetting();

  const expandedPaths = useMemo(() => {
    return new Set(savedExpandedPaths ?? []);
  }, [savedExpandedPaths]);

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
    (entry: FileTreeEntry) => {
      if (!activeWorkspaceId) return;
      expandPathToFile(activeWorkspaceId, entry.path);
      void openFileInFilesPage({
        workspaceId: activeWorkspaceId,
        path: entry.path,
        isFileTabsDisabled,
      });
    },
    [activeWorkspaceId, isFileTabsDisabled, expandPathToFile],
  );

  const handleFileTreeSearchResultClick = useCallback(
    (filePath: string) => {
      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, filePath);
        void openFileInFilesPage({
          workspaceId: activeWorkspaceId,
          path: filePath,
          isFileTabsDisabled,
        });
      }
    },
    [activeWorkspaceId, isFileTabsDisabled, expandPathToFile],
  );

  const handleLspOpenFile = useCallback(
    async (
      relativePath: string,
      shouldCommit: () => boolean,
    ): Promise<boolean> => {
      if (!activeWorkspaceId) return false;
      const opened = await openFileInFilesPage({
        workspaceId: activeWorkspaceId,
        path: relativePath,
        isFileTabsDisabled,
        shouldCommit,
      });
      if (opened) expandPathToFile(activeWorkspaceId, relativePath);
      return opened;
    },
    [activeWorkspaceId, isFileTabsDisabled, expandPathToFile],
  );
  useLspOpenFileHandler("files-page", handleLspOpenFile, () => {
    return useEditorStore.getState().activeFilePath;
  });

  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const { data: gitStatus } = useGitStatus(activeWorkspaceId);
  const isActiveFileUnstaged = useMemo(() => {
    if (!gitStatus || !activeFilePath) return false;
    return gitStatus.unstaged.some((f) => f.path === activeFilePath);
  }, [gitStatus, activeFilePath]);
  const { handleOpenMatch, isMobileSheetOpen, setIsMobileSheetOpen } =
    useFilesSearchNavigation({
      workspaceId: activeWorkspaceId,
      isFileTabsDisabled,
      isMobile,
    });
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const restoreTabsPromiseRef = useWorkspaceFileTabs(
    activeWorkspaceId,
    isFileTabsDisabled,
  );
  const openedFromParamRef = useRef<string | null>(null);

  useEffect(() => {
    const openPath = searchParams.get("open");
    if (!openPath || !activeWorkspaceId) return;
    if (openedFromParamRef.current === `${activeWorkspaceId}:${openPath}`)
      return;

    openedFromParamRef.current = `${activeWorkspaceId}:${openPath}`;

    expandPathToFile(activeWorkspaceId, openPath);

    // Wait for saved tabs to restore so they cannot steal focus from the
    // requested file (image previews open without a fetch, so they finish first).
    void (restoreTabsPromiseRef.current ?? Promise.resolve()).then(() =>
      openFileInFilesPage({
        workspaceId: activeWorkspaceId,
        path: openPath,
        isFileTabsDisabled,
      }),
    );
  }, [
    searchParams,
    activeWorkspaceId,
    expandPathToFile,
    isFileTabsDisabled,
    restoreTabsPromiseRef,
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

  const { lintFile } = useLintOnSave(
    activeWorkspaceId ?? undefined,
    activeFilePath ?? undefined,
  );
  const queryClient = useQueryClient();

  const handleSave = useCallback(async () => {
    const state = useEditorStore.getState();
    const activeFile = state.openFiles.find(
      (file) => file.path === state.activeFilePath,
    );
    if (!activeFile || !activeWorkspaceId) return;
    // Preview tabs hold no text content, so saving would truncate the file.
    if (isBinaryPreviewLanguage(activeFile.language)) return;

    setSavingPath(activeFile.path);
    const snapshot = {
      workspaceId: resolveTabWorkspaceId(activeFile, activeWorkspaceId),
      path: activeFile.path,
      instanceId: activeFile.instanceId,
      submittedBase: activeFile.originalContent,
      savedContent: activeFile.content,
    };
    try {
      await submitFileSave(
        buildFileSaveBody({
          workspaceId: snapshot.workspaceId,
          path: snapshot.path,
          content: snapshot.savedContent,
          originalContent: snapshot.submittedBase,
          isLspEnabled,
        }),
      );
      completeFileSave({
        snapshotWorkspaceId: snapshot.workspaceId,
        getBoundWorkspaceId: () =>
          useWorkspaceStore.getState().activeWorkspaceId,
        acknowledge: () => useEditorStore.getState().markFileSavedAs(snapshot),
        runFollowUps: () => {
          void lintFile();
          void queryClient.invalidateQueries({
            queryKey: ["git-status", snapshot.workspaceId],
          });
          toast.success("Saved");
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingPath(null);
    }
  }, [activeWorkspaceId, isLspEnabled, lintFile, queryClient]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const saveActiveFile = useCallback(() => void handleSaveRef.current(), []);

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
        handler: () => {
          useContentSearchStore.getState().setSidebarView("explorer");
          searchInputRef.current?.focus();
        },
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
  const isActiveFileImage = activeFile?.language === IMAGE_LANGUAGE;
  const sidebarProps = {
    workspaceId: activeWorkspaceId,
    isFileTabsDisabled,
    onOpenMatch: handleOpenMatch,
    fileTreeProps: {
      workspaceId: activeWorkspaceId,
      expandedPaths,
      activeFilePath,
      onToggleExpand: handleToggleExpand,
      onExpandPathToFile: handleExpandPathToFile,
      onFileClick: handleFileTreeFileClick,
      onSearchResultClick: handleFileTreeSearchResultClick,
      searchInputRef,
    },
  };
  return (
    <AuthenticatedLayout>
      <div className="flex h-full min-h-0 min-w-0">
        {isMobile && (
          <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
            <SheetContent
              side="left"
              className="w-[300px] p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <SheetHeader className="border-b px-3 py-2">
                <SheetTitle className="text-sm">Files</SheetTitle>
              </SheetHeader>
              <FilesSidebar {...sidebarProps} />
            </SheetContent>
          </Sheet>
        )}
        {!isMobile && isFileTreeOpen && (
          <div
            ref={(el) => {
              fileTreeFocusRef.current = el;
            }}
            tabIndex={-1}
            className="relative flex min-h-0 shrink-0 flex-col border-r outline-none"
            style={{ width: panelWidth }}
          >
            <FilesSidebar
              {...sidebarProps}
              headerActions={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={toggleFileTree}
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              }
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
                onClick={() => setIsMobileSheetOpen(true)}
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* File path breadcrumb */}
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
              {activeFile?.path ?? "No file open"}
            </span>

            <FileDiagnosticCounts
              workspaceId={activeWorkspaceId ?? undefined}
              filePath={activeFilePath ?? undefined}
            />
            <LspStatusToggle />

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
              <>
                <MarkdownPreviewToggle
                  language={activeFile.language}
                  filePath={activeFile.path}
                  size="sm"
                  className="h-7 w-7 p-0"
                />
                <CsvPreviewToggle
                  filePath={activeFile.path}
                  size="sm"
                  className="h-7 w-7 p-0"
                />
                {!isActiveFileImage && (
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
                {isActiveFileImage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    asChild
                  >
                    <a
                      href={getRawFileUrl(activeWorkspace.id, activeFile.path)}
                      download={activeFile.name}
                      aria-label="Download file"
                      title="Download file"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() =>
                      downloadTextFile(
                        activeFile.name,
                        useEditorStore
                          .getState()
                          .openFiles.find(
                            (file) => file.path === activeFile.path,
                          )?.content ?? "",
                      )
                    }
                    aria-label="Download file"
                    title="Download file"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
          </div>

          {/* File tabs */}
          {!isFileTabsDisabled && <FileTabs />}

          {/* Editor area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeFile && isActiveFileImage ? (
              <ImageViewer
                workspaceId={activeWorkspace.id}
                filePath={activeFile.path}
              />
            ) : activeFile ? (
              <>
                <div
                  className="min-h-0 flex-1 overflow-hidden"
                  data-lsp-surface="files-page"
                >
                  <FilesActiveEditor
                    ref={editorHandleRef}
                    language={activeFile.language}
                    onChange={handleChange}
                    onSave={saveActiveFile}
                    workspaceId={activeWorkspaceId ?? undefined}
                    filePath={activeFile.path}
                    isLspEligible={
                      !activeFile ||
                      resolveTabWorkspaceId(
                        activeFile,
                        activeWorkspaceId ?? activeWorkspace.id,
                      ) === activeWorkspaceId
                    }
                  />
                </div>
                <ProblemsPanel
                  workspaceId={activeWorkspaceId ?? undefined}
                  filePath={activeFile.path}
                  onNavigate={(line) =>
                    editorHandleRef.current?.revealLine(line)
                  }
                />
              </>
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
