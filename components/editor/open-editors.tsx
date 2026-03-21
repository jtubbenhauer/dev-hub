"use client";

import { useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, X, File } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function OpenEditors() {
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (openFiles.length === 0) return null;

  return (
    <div className="flex flex-col border-b">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[11px] font-medium tracking-wide uppercase"
          onClick={() => setIsCollapsed((v) => !v)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Open Editors
          <span className="ml-1 text-[10px] font-normal tabular-nums">
            ({openFiles.length})
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-0.5"
              onClick={closeAllFiles}
              aria-label="Close all editors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Close All
          </TooltipContent>
        </Tooltip>
      </div>

      {!isCollapsed && (
        <div className="pb-1">
          {openFiles.map((file) => {
            const isActive = file.path === activeFilePath;
            return (
              <div
                key={file.path}
                className={cn(
                  "group flex w-full items-center gap-1 rounded-sm px-2 py-0.5 text-sm",
                  isActive && "bg-accent text-accent-foreground",
                )}
              >
                <button
                  type="button"
                  aria-label={`Close ${file.name}`}
                  className={cn(
                    "hover:bg-accent-foreground/10 shrink-0 rounded p-0.5",
                    !isActive && "opacity-0 group-hover:opacity-100",
                  )}
                  onClick={() => closeFile(file.path)}
                >
                  <X className="h-3 w-3" />
                </button>

                <button
                  type="button"
                  className="hover:bg-accent flex min-w-0 flex-1 items-center gap-1 rounded-sm"
                  onClick={() => setActiveFile(file.path)}
                >
                  <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {file.isDirty && (
                      <span className="mr-1 text-orange-400">●</span>
                    )}
                    {file.name}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
