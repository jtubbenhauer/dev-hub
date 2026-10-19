"use client";
import { memo } from "react";
import { useEditorTabMetadataSelector } from "@/hooks/use-editor-tab-metadata";
import { useLeaderAction } from "@/hooks/use-leader-action";

import { useEditorStore } from "@/stores/editor-store";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

// Closing a tab throws away its unsaved edits, so ask first when it has any.
function closeTabWithConfirm(path: string) {
  const { openFiles, closeFile } = useEditorStore.getState();
  const file = openFiles.find((openFile) => openFile.path === path);
  if (
    file?.isDirty &&
    !window.confirm(`${file.name} has unsaved changes. Close and discard them?`)
  ) {
    return;
  }
  closeFile(path);
}

// Module-level so useLeaderAction gets the stable array it requires.
const fileTabLeaderActions = [
  {
    action: {
      id: "files:next-tab",
      label: "Next tab",
      page: "files",
      isRepeatable: true,
    },
    handler: () => useEditorStore.getState().cycleActiveFile("next"),
  },
  {
    action: {
      id: "files:prev-tab",
      label: "Previous tab",
      page: "files",
      isRepeatable: true,
    },
    handler: () => useEditorStore.getState().cycleActiveFile("previous"),
  },
  {
    action: { id: "files:close-tab", label: "Close tab", page: "files" },
    handler: () => {
      const { activeFilePath } = useEditorStore.getState();
      if (activeFilePath) closeTabWithConfirm(activeFilePath);
    },
  },
];

export const FileTabs = memo(function FileTabs() {
  useLeaderAction(fileTabLeaderActions);
  const openFiles = useEditorStore(useEditorTabMetadataSelector());
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);

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
                aria-label={`Close ${file.name}`}
                className={cn(
                  "hover:bg-accent ml-1 rounded p-0.5",
                  !isActive && "opacity-0 group-hover:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTabWithConfirm(file.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeTabWithConfirm(file.path);
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
});
