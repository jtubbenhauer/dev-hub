"use client";

import { GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidePanelStore } from "@/stores/side-panel-store";

import type { Workspace } from "@/types";
import type { Todo, MessageWithParts } from "@/lib/opencode/types";

import { McpStatusPanel } from "./mcp-status";
import { SessionFilesPanel } from "./session-files-panel";
import { SplitPanelFiles } from "./split-panel-files";
import { TaskProgressPanel } from "./task-progress";
import { WorkspaceContextPanel } from "./workspace-context-panel";

export interface SidePanelProps {
  width: number;
  handleDragStart: (e: React.MouseEvent) => void;
  workspaceId: string;
  onEscape?: () => void;
  workspace: Workspace;
  activeTodos: Todo[];
  messages: MessageWithParts[];
  workspacePath: string;
}

export function SidePanel({
  width,
  handleDragStart,
  workspaceId,
  onEscape,
  workspace,
  activeTodos,
  messages,
  workspacePath,
}: SidePanelProps) {
  const activePanelTab = useSidePanelStore((s) => s.activePanelTab);
  const setActivePanelTab = useSidePanelStore((s) => s.setActivePanelTab);
  const closePanel = useSidePanelStore((s) => s.closePanel);

  return (
    <>
      <div
        data-testid="side-panel-resize-handle"
        className="hover:bg-accent/50 active:bg-accent hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors md:flex"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="text-muted-foreground/30 size-3.5" />
      </div>

      <div
        className="relative hidden shrink-0 overflow-y-auto border-l md:block"
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEscape?.();
        }}
      >
        <div className="flex h-10 items-center justify-between border-b px-3">
          <div className="flex gap-3">
            <button
              className={`text-xs ${activePanelTab === "status" ? "text-foreground font-medium" : "text-muted-foreground"}`}
              onClick={() => setActivePanelTab("status")}
            >
              Status
            </button>
            <button
              className={`text-xs ${activePanelTab === "files" ? "text-foreground font-medium" : "text-muted-foreground"}`}
              onClick={() => setActivePanelTab("files")}
            >
              Files
            </button>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            data-testid="side-panel-close"
            onClick={closePanel}
          >
            <X className="size-3" />
          </Button>
        </div>

        {activePanelTab === "status" ? (
          <>
            {workspaceId && workspace && (
              <WorkspaceContextPanel
                workspaceId={workspaceId}
                workspace={workspace}
              />
            )}
            {activeTodos.length > 0 && (
              <>
                <div className="border-t px-3 py-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    Task Progress
                  </span>
                </div>
                <div className="px-3 pb-3">
                  <TaskProgressPanel todos={activeTodos} />
                </div>
              </>
            )}
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                MCP Servers
              </span>
            </div>
            <div className="px-3 pb-3">
              <McpStatusPanel />
            </div>
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                Session Files
              </span>
            </div>
            <div className="px-3 pb-3">
              <SessionFilesPanel
                messages={messages}
                workspacePath={workspacePath}
              />
            </div>
          </>
        ) : (
          <SplitPanelFiles workspaceId={workspaceId} />
        )}
      </div>
    </>
  );
}
