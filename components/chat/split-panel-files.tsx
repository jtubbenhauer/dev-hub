"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FolderOpen,
  Loader2,
  Save,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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

function flattenTree(entries: FileTreeEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      result.push(entry.path);
    }
    if (entry.children) {
      result.push(...flattenTree(entry.children));
    }
  }
  return result;
}

export function SplitPanelFiles({
  workspaceId,
  workspacePath,
}: SplitPanelFilesProps) {
  const currentFilePath = useSplitPanelStore((s) => s.currentFilePath);
  const currentFileContent = useSplitPanelStore((s) => s.currentFileContent);
  const currentFileLanguage = useSplitPanelStore((s) => s.currentFileLanguage);
  const isDirty = useSplitPanelStore((s) => s.isDirty);
  const isFilePickerOpen = useSplitPanelStore((s) => s.isFilePickerOpen);
  const isLoading = useSplitPanelStore((s) => s.isLoading);
  const error = useSplitPanelStore((s) => s.error);

  const openFile = useSplitPanelStore((s) => s.openFile);
  const setContent = useSplitPanelStore((s) => s.setContent);
  const markSaved = useSplitPanelStore((s) => s.markSaved);
  const setError = useSplitPanelStore((s) => s.setError);
  const clearError = useSplitPanelStore((s) => s.clearError);
  const toggleFilePicker = useSplitPanelStore((s) => s.toggleFilePicker);
  const setIsLoading = useSplitPanelStore((s) => s.setIsLoading);
  const clearFile = useSplitPanelStore((s) => s.clearFile);

  const activeSessionId = useChatStore((s) => s.activeSessionId);

  const [filterText, setFilterText] = useState("");
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    clearFile();
  }, [workspaceId, clearFile]);

  const { data: treeData } = useQuery<FileTreeEntry[]>({
    queryKey: ["file-tree", workspaceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/files/tree?workspaceId=${workspaceId}&depth=10`,
      );
      if (!res.ok) throw new Error("Failed to fetch file tree");
      return res.json();
    },
    staleTime: 30_000,
    enabled: !!workspaceId,
  });

  const allFiles = treeData ? flattenTree(treeData) : [];
  const filteredFiles = filterText
    ? allFiles.filter((f) => f.toLowerCase().includes(filterText.toLowerCase()))
    : allFiles;

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

        openFile(path, content, data.language ?? "plaintext");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load file");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [workspaceId, setIsLoading, clearError, setError, openFile],
  );

  const handleFileClick = useCallback(
    (path: string) => {
      if (isDirty) {
        setPendingFilePath(path);
        return;
      }
      loadFile(path);
    },
    [isDirty, loadFile],
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
      <div className="border-b">
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent flex w-full items-center gap-1.5 px-3 py-1.5 text-xs"
          onClick={toggleFilePicker}
        >
          {isFilePickerOpen ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <FolderOpen className="size-3" />
          <span>Browse files</span>
        </button>

        {isFilePickerOpen && (
          <div className="border-t px-2 pb-2">
            <div className="relative mt-1.5 mb-1.5">
              <Search className="text-muted-foreground absolute top-1/2 left-2 size-3 -translate-y-1/2" />
              <Input
                placeholder="Filter files…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <ScrollArea className="max-h-48">
              {filteredFiles.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-center text-xs">
                  {treeData ? "No files match filter" : "Loading…"}
                </p>
              ) : (
                <div className="space-y-px">
                  {filteredFiles.map((filePath) => (
                    <button
                      key={filePath}
                      type="button"
                      className={`hover:bg-accent flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs ${
                        filePath === currentFilePath
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground"
                      }`}
                      onClick={() => handleFileClick(filePath)}
                    >
                      <File className="size-3 shrink-0" />
                      <span className="truncate">{filePath}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

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
