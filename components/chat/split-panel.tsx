"use client";

import { GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSplitPanelStore } from "@/stores/split-panel-store";

import { SplitPanelFiles } from "./split-panel-files";

interface SplitPanelProps {
  width: number;
  handleDragStart: (e: React.MouseEvent) => void;
  workspaceId: string;
  workspacePath: string;
  onEscape?: () => void;
}

export function SplitPanel({
  width,
  handleDragStart,
  workspaceId,
  workspacePath,
  onEscape,
}: SplitPanelProps) {
  return (
    <>
      <div
        className="hover:bg-accent/50 active:bg-accent hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors md:flex"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="text-muted-foreground/30 size-3.5" />
      </div>

      <div
        data-testid="split-panel"
        className="relative hidden shrink-0 overflow-y-auto border-l md:block"
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEscape?.();
        }}
      >
        <div className="flex h-10 items-center justify-between border-b px-3">
          <span className="text-muted-foreground text-xs font-medium">
            Files
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            data-testid="split-panel-close"
            onClick={() => useSplitPanelStore.getState().closePanel()}
          >
            <X className="size-3" />
          </Button>
        </div>

        <SplitPanelFiles
          workspaceId={workspaceId}
          workspacePath={workspacePath}
        />
      </div>
    </>
  );
}
