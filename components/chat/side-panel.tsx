"use client";

import { useMemo } from "react";

import { GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidePanelStore } from "@/stores/side-panel-store";
import { useGitStatus } from "@/hooks/use-git";

import type { Workspace } from "@/types";
import type { Todo, MessageWithParts } from "@/lib/opencode/types";

import { McpStatusPanel } from "./mcp-status";
import { GitTabPanel } from "@/components/chat/git-tab-panel";
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

  const { data: gitStatus } = useGitStatus(workspaceId);
  const dirtyCount = useMemo(() => {
    if (!gitStatus || !gitStatus.isRepo) return 0;
    const paths = new Set<string>();
    for (const f of gitStatus.staged) paths.add(f.path);
    for (const f of gitStatus.unstaged) paths.add(f.path);
    for (const p of gitStatus.untracked) paths.add(p);
    for (const p of gitStatus.conflicted) paths.add(p);
    return paths.size;
  }, [gitStatus]);

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
              className={`border-b-2 px-1 pb-1.5 text-xs transition-colors ${activePanelTab === "status" ? "text-foreground border-primary font-medium" : "text-muted-foreground hover:text-foreground/70 border-transparent"}`}
              onClick={() => setActivePanelTab("status")}
            >
              Status
            </button>
            <button
              className={`border-b-2 px-1 pb-1.5 text-xs transition-colors ${activePanelTab === "files" ? "text-foreground border-primary font-medium" : "text-muted-foreground hover:text-foreground/70 border-transparent"}`}
              onClick={() => setActivePanelTab("files")}
            >
              Files
            </button>
            <button
              className={`flex items-center gap-1 border-b-2 px-1 pb-1.5 text-xs transition-colors ${activePanelTab === "git" ? "text-foreground border-primary font-medium" : "text-muted-foreground hover:text-foreground/70 border-transparent"}`}
              onClick={() => setActivePanelTab("git")}
            >
              Git
              {dirtyCount > 0 && (
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px] tabular-nums">
                  {dirtyCount}
                </span>
              )}
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

        {activePanelTab === "status" && (
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
        )}
        {activePanelTab === "files" && (
          <SplitPanelFiles workspaceId={workspaceId} />
        )}
        {activePanelTab === "git" && <GitTabPanel workspaceId={workspaceId} />}
      </div>
    </>
  );
}
