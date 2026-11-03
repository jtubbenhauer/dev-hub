"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileCode2, ChevronRight, ChevronDown, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type SessionFile } from "@/lib/chat/extract-session-files";
import { useSessionFiles } from "@/components/chat/use-session-files";
import type { MessageWithParts } from "@/lib/opencode/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useChatFileOpenSetting,
  useFileTabsSetting,
} from "@/hooks/use-settings";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import {
  fileViewKey,
  isOutsideRepoPath,
  toRepoRelative,
} from "@/lib/workspace-paths";
import { openFileInWorkbench } from "@/lib/workbench/open-in-workbench";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useEditorStore } from "@/stores/editor-store";
import { toast } from "sonner";

const FileRow = memo(function FileRow({
  file,
  workspacePath,
  onFileOpen,
}: {
  file: SessionFile;
  workspacePath: string;
  onFileOpen?: () => void;
}) {
  const router = useRouter();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { fileOpenMode } = useChatFileOpenSetting();
  const { isFileTabsDisabled } = useFileTabsSetting();
  const relativePath = toRepoRelative(file.path, workspacePath);
  const href = createWorkbenchHref({
    open: "file",
    workspaceId: activeWorkspaceId,
    path: relativePath,
  });

  const handleClick = useCallback(async () => {
    // Closes a containing mobile sheet so the dialog or tab is visible.
    onFileOpen?.();
    if (fileOpenMode === "dialog") {
      await useChatFileDialogStore
        .getState()
        .openFile(activeWorkspaceId ?? "", relativePath, () =>
          router.push(href),
        );
      return;
    }
    if (activeWorkspaceId === null) {
      router.push(href);
      return;
    }
    await openFileInWorkbench({
      workspaceId: activeWorkspaceId,
      path: relativePath,
      isFileTabsDisabled,
      navigate: (target) => router.push(target),
    });
  }, [
    router,
    href,
    relativePath,
    fileOpenMode,
    activeWorkspaceId,
    isFileTabsDisabled,
    onFileOpen,
  ]);

  const handleOpenGitDiff = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isOutsideRepoPath(relativePath)) return; // unreachable but defensive
      if (activeWorkspaceId === null) return;
      // Set before opening: the file tab reads its view mode when it mounts.
      useEditorStore
        .getState()
        .setFileViewMode(fileViewKey(activeWorkspaceId, relativePath), "diff");
      const isOpened = await openFileInWorkbench({
        workspaceId: activeWorkspaceId,
        path: relativePath,
        isFileTabsDisabled,
        navigate: (target) => router.push(target),
      });
      if (!isOpened) toast.error("Could not open file");
    },
    [relativePath, activeWorkspaceId, isFileTabsDisabled, router],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs",
        "hover:bg-accent cursor-pointer text-left transition-colors",
      )}
    >
      <FileCode2 className="text-muted-foreground size-3.5 shrink-0" />
      <Tooltip delayDuration={500} disableHoverableContent>
        <TooltipTrigger asChild>
          <span className="flex-1 truncate">{relativePath}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{relativePath}</TooltipContent>
      </Tooltip>
      {!isOutsideRepoPath(relativePath) && (
        <span
          onClick={handleOpenGitDiff}
          title="Open in git diff"
          className="text-muted-foreground hover:text-foreground hidden shrink-0 rounded p-0.5 transition-colors group-hover:block"
        >
          <GitCompare className="size-3" />
        </span>
      )}
      {file.action === "created" && (
        <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          new
        </span>
      )}
      {file.action === "modified" && (
        <span className="shrink-0 rounded bg-blue-500/15 px-1 text-[10px] text-blue-600 dark:text-blue-400">
          mod
        </span>
      )}
    </button>
  );
});

function resolveWorkspacePath(
  messages: MessageWithParts[],
  fallbackPath: string,
): string {
  for (const msg of messages) {
    if (msg.info.role === "assistant" && "path" in msg.info) {
      const root = (msg.info.path as { root: string }).root;
      if (root) return root;
    }
  }
  return fallbackPath;
}

export const SessionFilesPanel = memo(function SessionFilesPanel({
  messages,
  workspacePath,
  onFileOpen,
}: {
  messages: MessageWithParts[];
  workspacePath: string;
  onFileOpen?: () => void;
}) {
  const { files, hasUnloadedHistory } = useSessionFiles(messages);
  const resolvedPath = useMemo(
    () => resolveWorkspacePath(messages, workspacePath),
    [messages, workspacePath],
  );
  const [isReadExpanded, setIsReadExpanded] = useState(false);

  const modifiedFiles = useMemo(
    () =>
      files.filter((f) => f.action === "created" || f.action === "modified"),
    [files],
  );
  const readFiles = useMemo(
    () => files.filter((f) => f.action === "read"),
    [files],
  );

  if (files.length === 0 && !hasUnloadedHistory) return null;

  return (
    <div className="space-y-2">
      {modifiedFiles.length > 0 && (
        <div className="space-y-0.5">
          {modifiedFiles.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              workspacePath={resolvedPath}
              onFileOpen={onFileOpen}
            />
          ))}
        </div>
      )}
      {readFiles.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setIsReadExpanded((prev) => !prev)}
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-1.5 py-1 text-xs transition-colors"
          >
            {isReadExpanded ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            <span>Read ({readFiles.length})</span>
          </button>
          {isReadExpanded && (
            <div className="space-y-0.5">
              {readFiles.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  workspacePath={resolvedPath}
                  onFileOpen={onFileOpen}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {hasUnloadedHistory && (
        <div
          data-testid="session-files-unloaded-hint"
          className="text-muted-foreground px-1.5 py-1 text-[11px] italic"
        >
          Some sub-agent history isn&apos;t loaded yet — file list may be
          incomplete.
        </div>
      )}
    </div>
  );
});
