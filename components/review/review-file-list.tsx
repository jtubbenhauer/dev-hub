"use client";

import { useCallback, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, isEditorElement } from "@/lib/utils";
import {
  Check,
  FilePlus,
  FileEdit,
  FileMinus,
  FileQuestion,
  ArrowRight,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewFile, ReviewFileStatus } from "@/types";

interface ReviewFileListProps {
  files: ReviewFile[];
  selectedFileId: number | null;
  onSelectFile: (file: ReviewFile) => void;
  onToggleReviewed: (file: ReviewFile) => void;
}

const statusIcons: Record<ReviewFileStatus, typeof File> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: ArrowRight,
  copied: ArrowRight,
  "type-changed": FileEdit,
  untracked: FileQuestion,
};

const statusColors: Record<ReviewFileStatus, string> = {
  added: "text-green-500",
  modified: "text-yellow-500",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  copied: "text-blue-500",
  "type-changed": "text-purple-500",
  untracked: "text-gray-400",
};

const statusLetters: Record<ReviewFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "?",
};

function sortFilesUnreviewedFirst(files: ReviewFile[]): ReviewFile[] {
  return [...files].sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    return a.path.localeCompare(b.path);
  });
}

export function ReviewFileList({
  files,
  selectedFileId,
  onSelectFile,
  onToggleReviewed,
}: ReviewFileListProps) {
  const sorted = sortFilesUnreviewedFirst(files);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = sorted.findIndex((f) => f.id === selectedFileId);

  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && isEditorElement(e.target))
      ) {
        return;
      }

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const nextIdx = Math.min(selectedIndex + 1, sorted.length - 1);
          if (sorted[nextIdx]) onSelectFile(sorted[nextIdx]);
          break;
        }
        case "k": {
          e.preventDefault();
          const prevIdx = Math.max(selectedIndex - 1, 0);
          if (sorted[prevIdx]) onSelectFile(sorted[prevIdx]);
          break;
        }
      }
    },
    [selectedIndex, sorted, onSelectFile],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div ref={listRef} className="py-1">
        {sorted.map((file) => {
          const Icon = statusIcons[file.status];
          const isSelected = file.id === selectedFileId;
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";

          return (
            <div
              key={file.id}
              className={cn(
                "flex w-full items-center gap-1 pr-1 transition-colors",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50",
                file.reviewed && "opacity-50",
              )}
            >
              <button
                onClick={() => onSelectFile(file)}
                onDoubleClick={() => onToggleReviewed(file)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <span className="w-4 shrink-0 text-center">
                  {file.reviewed ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <span
                      className={cn(
                        "font-mono text-xs font-bold",
                        statusColors[file.status],
                      )}
                    >
                      {statusLetters[file.status]}
                    </span>
                  )}
                </span>

                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    statusColors[file.status],
                  )}
                />

                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="text-muted-foreground block truncate text-[10px]">
                      {dirPath}
                    </span>
                  )}
                </div>
              </button>

              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6 shrink-0 rounded",
                  file.reviewed
                    ? "text-green-500 hover:text-green-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReviewed(file);
                }}
                title={file.reviewed ? "Unmark reviewed" : "Mark as reviewed"}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
