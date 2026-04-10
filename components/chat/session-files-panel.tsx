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
import {
  extractSessionFiles,
  type SessionFile,
} from "@/lib/chat/extract-session-files";
import type { MessageWithParts } from "@/lib/opencode/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSplitPanelStore } from "@/stores/split-panel-store";

function stripWorkspacePrefix(filePath: string, workspacePath: string): string {
  if (!workspacePath) return filePath;
  const prefix = workspacePath.endsWith("/")
    ? workspacePath
    : workspacePath + "/";
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  return filePath;
}

const FileRow = memo(function FileRow({
  file,
  workspacePath,
}: {
  file: SessionFile;
  workspacePath: string;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const relativePath = stripWorkspacePrefix(file.path, workspacePath);

  const handleClick = useCallback(async () => {
    if (isMobile) {
      router.push(`/files?open=${encodeURIComponent(relativePath)}`);
      return;
    }
    const { setIsLoading, clearError, openFile } =
      useSplitPanelStore.getState();
    setIsLoading(true);
    clearError();
    try {
      const res = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(relativePath)}`,
      );
      if (!res.ok) {
        router.push(`/files?open=${encodeURIComponent(relativePath)}`);
        return;
      }
      const data = (await res.json()) as {
        content: string;
        language?: string;
      };
      openFile(relativePath, data.content, data.language ?? "plaintext");
    } catch {
      router.push(`/files?open=${encodeURIComponent(relativePath)}`);
    } finally {
      setIsLoading(false);
    }
  }, [router, relativePath, isMobile, activeWorkspaceId]);

  const handleOpenGitDiff = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      localStorage.setItem("dev-hub:git-picker-selected-file", relativePath);
      localStorage.setItem("dev-hub:git-view-mode", "working");
      router.push("/git");
      window.dispatchEvent(
        new CustomEvent("devhub:git-select-file", {
          detail: { path: relativePath, staged: false },
        }),
      );
    },
    [router, relativePath],
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
      <span
        onClick={handleOpenGitDiff}
        title="Open in git diff"
        className="text-muted-foreground hover:text-foreground hidden shrink-0 rounded p-0.5 transition-colors group-hover:block"
      >
        <GitCompare className="size-3" />
      </span>
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
}: {
  messages: MessageWithParts[];
  workspacePath: string;
}) {
  const files = useMemo(() => extractSessionFiles(messages), [messages]);
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

  if (files.length === 0) return null;

  return (
    <div className="space-y-2">
      {modifiedFiles.length > 0 && (
        <div className="space-y-0.5">
          {modifiedFiles.map((file) => (
            <FileRow key={file.path} file={file} workspacePath={resolvedPath} />
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
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
