"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  Save,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CommentsSidebar } from "@/components/editor/comments-sidebar";
import { FileTree } from "@/components/editor/file-tree";
import { SplitPanelFileTabs } from "@/components/chat/split-panel-file-tabs";
import { useSplitPanelStore } from "@/stores/split-panel-store";
import { useChatStore } from "@/stores/chat-store";
import {
  useFileComments,
  useResolveFileComment,
  useDeleteFileComment,
  useUpdateFileComment,
} from "@/hooks/use-file-comments";
import { attachCommentToChat } from "@/lib/comment-chat-bridge";
import type { FileTreeEntry, FileComment } from "@/types";

const MonacoEditor = dynamic(
  () => import("@/components/editor/monaco-editor").then((m) => m.MonacoEditor),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

interface SplitPanelFilesProps {
  workspaceId: string;
  workspacePath: string;
}

const BINARY_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".wasm",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".mp4",
  ".mov",
  ".ttf",
  ".woff",
  ".woff2",
  ".eot",
];

export function SplitPanelFiles({
  workspaceId,
  workspacePath: _workspacePath,
}: SplitPanelFilesProps) {
  const openFiles = useSplitPanelStore((s) => s.openFiles);
  const activeFilePath = useSplitPanelStore((s) => s.activeFilePath);
  const isFilePickerOpen = useSplitPanelStore((s) => s.isFilePickerOpen);
  const isLoading = useSplitPanelStore((s) => s.isLoading);
  const error = useSplitPanelStore((s) => s.error);

  const openFileInTab = useSplitPanelStore((s) => s.openFileInTab);
  const setContent = useSplitPanelStore((s) => s.setContent);
  const markSaved = useSplitPanelStore((s) => s.markSaved);
  const setError = useSplitPanelStore((s) => s.setError);
  const clearError = useSplitPanelStore((s) => s.clearError);
  const toggleFilePicker = useSplitPanelStore((s) => s.toggleFilePicker);
  const setIsLoading = useSplitPanelStore((s) => s.setIsLoading);
  const clearFile = useSplitPanelStore((s) => s.clearFile);

  const activeSessionId = useChatStore((s) => s.activeSessionId);

  const expandedPaths = useSplitPanelStore((s) => s.expandedPaths);
  const toggleExpandedPath = useSplitPanelStore((s) => s.toggleExpandedPath);
  const expandPathToFile = useSplitPanelStore((s) => s.expandPathToFile);

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath],
  );
  const currentFilePath = activeFile?.path ?? null;
  const currentFileContent = activeFile?.content ?? null;
  const currentFileLanguage = activeFile?.language ?? null;
  const isDirty = activeFile?.isDirty ?? false;

  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const expandedPathsSet = useMemo(
    () => new Set(expandedPaths),
    [expandedPaths],
  );

  useEffect(() => {
    clearFile();
  }, [workspaceId, clearFile]);

  const { data: comments = [] } = useFileComments(
    workspaceId,
    currentFilePath ?? undefined,
  );
  const { mutate: resolveComment } = useResolveFileComment();
  const { mutate: deleteComment } = useDeleteFileComment();
  const { mutate: updateComment } = useUpdateFileComment();

  const loadFile = useCallback(
    async (path: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      clearError();

      try {
        const res = await fetch(
          `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent(path)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setError(`File not found: ${path}`);
          return;
        }
        const data = await res.json();
        const content: string = data.content;

        const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
        if (BINARY_EXTENSIONS.includes(ext) || content.includes("\0")) {
          setError(`BINARY:${path}`);
          return;
        }

        if (content.length > 1_000_000) {
          setError(`LARGE:${(content.length / 1_000_000).toFixed(1)}MB`);
          return;
        }

        openFileInTab(path, content, data.language ?? "plaintext");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load file");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [workspaceId, setIsLoading, clearError, setError, openFileInTab],
  );

  const handleFileClick = useCallback(
    (path: string) => {
      const existingTab = openFiles.find((f) => f.path === path);
      if (existingTab) {
        useSplitPanelStore.getState().setActiveTab(path);
        return;
      }
      if (isDirty) {
        setPendingFilePath(path);
        return;
      }
      loadFile(path);
    },
    [openFiles, isDirty, loadFile],
  );

  const handleTreeFileClick = useCallback(
    (entry: FileTreeEntry) => {
      if (entry.type === "file") {
        handleFileClick(entry.path);
      }
    },
    [handleFileClick],
  );

  const handleTreeSearchResultClick = useCallback(
    (filePath: string) => {
      handleFileClick(filePath);
    },
    [handleFileClick],
  );

  const saveFileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          path: currentFilePath,
          content: currentFileContent,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => markSaved(),
    onError: () => toast.error("Failed to save file"),
  });

  const handleSave = useCallback(() => {
    if (currentFilePath && isDirty) {
      saveFileMutation.mutate();
    }
  }, [currentFilePath, isDirty, saveFileMutation]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        if (currentFilePath && isDirty) {
          e.preventDefault();
          saveFileMutation.mutate();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentFilePath, isDirty, saveFileMutation]);

  const handleDirtyDialogSave = useCallback(() => {
    const pending = pendingFilePath;
    saveFileMutation.mutate(undefined, {
      onSuccess: () => {
        if (pending) loadFile(pending);
        setPendingFilePath(null);
      },
    });
  }, [pendingFilePath, saveFileMutation, loadFile]);

  const handleDirtyDialogDiscard = useCallback(() => {
    markSaved();
    const pending = pendingFilePath;
    setPendingFilePath(null);
    if (pending) loadFile(pending);
  }, [pendingFilePath, markSaved, loadFile]);

  const handleDirtyDialogCancel = useCallback(() => {
    setPendingFilePath(null);
  }, []);

  const handleAttachToChat = useCallback(
    (comment: FileComment) => {
      attachCommentToChat({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        endLine: comment.endLine,
        body: comment.body,
        workspaceId,
        sessionId: activeSessionId,
      });
    },
    [workspaceId, activeSessionId],
  );

  const handleResolve = useCallback(
    (id: number) => {
      resolveComment({ id, resolved: true });
    },
    [resolveComment],
  );

  const handleDelete = useCallback(
    (id: number) => {
      deleteComment(id);
    },
    [deleteComment],
  );

  const handleUpdate = useCallback(
    (id: number, body: string) => {
      updateComment({ id, body });
    },
    [updateComment],
  );

  const handleCloseComments = useCallback(() => {
    setIsCommentsOpen(false);
  }, []);

  const filename = currentFilePath?.split("/").pop() ?? "";

  return (
    <div className="flex h-[calc(100%-2.5rem)] flex-col">
      {isFilePickerOpen && (
        <div
          className="flex min-h-0 shrink-0 flex-col border-b"
          style={{
            maxHeight:
              currentFilePath && !error && !isLoading ? "40%" : undefined,
          }}
        >
          <div className="flex shrink-0 items-center justify-between px-3 py-1">
            <span className="text-muted-foreground text-xs font-medium">
              Explorer
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleFilePicker}
            >
              <ChevronDown className="size-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <FileTree
              workspaceId={workspaceId}
              expandedPaths={expandedPathsSet}
              activeFilePath={currentFilePath}
              onToggleExpand={toggleExpandedPath}
              onExpandPathToFile={expandPathToFile}
              onFileClick={handleTreeFileClick}
              onSearchResultClick={handleTreeSearchResultClick}
            />
          </div>
        </div>
      )}

      {!isFilePickerOpen && (
        <div className="border-b">
          <button
            type="button"
            className="text-muted-foreground hover:bg-accent flex w-full items-center gap-1.5 px-3 py-1.5 text-xs"
            onClick={toggleFilePicker}
          >
            <ChevronRight className="size-3" />
            <FolderOpen className="size-3" />
            <span>Browse files</span>
          </button>
        </div>
      )}

      <SplitPanelFileTabs />

      {currentFilePath && !error && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <span
            data-testid="split-panel-filename"
            className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
            title={currentFilePath}
          >
            {currentFilePath}
          </span>
          {isDirty && (
            <span className="bg-warning size-1.5 shrink-0 rounded-full" />
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            data-testid="split-panel-save"
            disabled={!isDirty || saveFileMutation.isPending}
            onClick={handleSave}
            title="Save (Cmd+S)"
          >
            {saveFileMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
          </Button>
          <Link
            href={`/files?open=${encodeURIComponent(currentFilePath)}`}
            className="text-muted-foreground hover:text-foreground"
            title="Open in full editor"
          >
            <ExternalLink className="size-3" />
          </Link>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      )}

      {!currentFilePath && !error && !isLoading && (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-center text-sm">
          Click a file path in chat or browse files above to open a file
        </div>
      )}

      {error && !isLoading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {error.startsWith("BINARY:") ? (
            <>
              <p className="text-muted-foreground text-sm">
                Cannot display binary file: {error.slice(7).split("/").pop()}
              </p>
              <Link
                href={`/files?open=${encodeURIComponent(error.slice(7))}`}
                className="text-primary text-xs underline"
              >
                Open in full editor
              </Link>
            </>
          ) : error.startsWith("LARGE:") ? (
            <>
              <p className="text-muted-foreground text-sm">
                File too large to display ({error.slice(6)})
              </p>
              {currentFilePath && (
                <Link
                  href={`/files?open=${encodeURIComponent(currentFilePath)}`}
                  className="text-primary text-xs underline"
                >
                  Open in full editor
                </Link>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{error}</p>
          )}
        </div>
      )}

      {currentFilePath &&
        !error &&
        !isLoading &&
        currentFileContent !== null && (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <MonacoEditor
                content={currentFileContent}
                language={currentFileLanguage ?? "plaintext"}
                onChange={setContent}
                onSave={handleSave}
                filePath={currentFilePath}
                workspaceId={workspaceId}
              />
            </div>
            {isCommentsOpen && comments.length > 0 && (
              <div className="w-64 shrink-0 border-l">
                <CommentsSidebar
                  comments={comments}
                  onScrollToLine={() => {}}
                  onResolve={handleResolve}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                  onAttachToChat={handleAttachToChat}
                  onClose={handleCloseComments}
                />
              </div>
            )}
          </div>
        )}

      {currentFilePath &&
        !error &&
        !isLoading &&
        comments.length > 0 &&
        !isCommentsOpen && (
          <div className="border-t px-3 py-1">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() => setIsCommentsOpen(true)}
            >
              {comments.length} comment{comments.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}

      <AlertDialog
        open={pendingFilePath !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFilePath(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to {filename}. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDirtyDialogCancel}>
              Cancel
            </AlertDialogCancel>
            <Button variant="outline" onClick={handleDirtyDialogDiscard}>
              Discard
            </Button>
            <AlertDialogAction onClick={handleDirtyDialogSave}>
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
