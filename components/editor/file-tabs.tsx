"use client";

import { useEditorStore } from "@/stores/editor-store";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function FileTabs() {
  const { openFiles, activeFilePath, setActiveFile, closeFile } =
    useEditorStore();

  if (openFiles.length === 0) return null;

  return (
    <ScrollArea className="w-full shrink-0 border-b">
      <div className="flex h-9">
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath;
          return (
            <button
              key={file.path}
              className={cn(
                "group flex h-full shrink-0 items-center gap-1.5 border-r px-3 text-xs transition-colors",
                isActive
                  ? "bg-background text-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setActiveFile(file.path)}
            >
              <span className="max-w-[120px] truncate">
                {file.isDirty && (
                  <span className="mr-1 text-orange-400">●</span>
                )}
                {file.name}
              </span>
              <span
                role="button"
                tabIndex={0}
                className={cn(
                  "hover:bg-accent ml-1 rounded p-0.5",
                  !isActive && "opacity-0 group-hover:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeFile(file.path);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
