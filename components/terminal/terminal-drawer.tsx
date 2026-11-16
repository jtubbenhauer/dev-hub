"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2, TerminalSquare, X } from "lucide-react";
import { TerminalActivityWatcher } from "./terminal-activity-watcher";
import { WorkspaceTerminal } from "./workspace-terminal";
import { useDrawerResize } from "./use-drawer-resize";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { openChatInWorkbench } from "@/lib/workbench/open-in-workbench";

const DEFAULT_DRAWER_HEIGHT = "min(60vh, 600px)";
const MAXIMIZED_DRAWER_HEIGHT = "calc(100vh - 3rem)";

function drawerHeight(isMaximized: boolean, heightPx: number | null): string {
  if (isMaximized) return MAXIMIZED_DRAWER_HEIGHT;
  if (heightPx === null) return DEFAULT_DRAWER_HEIGHT;
  return `min(${heightPx}px, ${MAXIMIZED_DRAWER_HEIGHT})`;
}

export function TerminalDrawer() {
  const isOpen = useTerminalStore((s) => s.isOpen);
  const isMaximized = useTerminalStore((s) => s.isMaximized);
  const drawerHeightPx = useTerminalStore((s) => s.drawerHeightPx);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const { isResizing, handleResizePointerDown } = useDrawerResize();
  const [hasEverOpened, setHasEverOpened] = useState(false);

  if (isOpen && !hasEverOpened) {
    setHasEverOpened(true);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "`" &&
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        useTerminalStore.getState().toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const closeDrawer = () => useTerminalStore.getState().setOpen(false);

  return (
    <>
      <TerminalActivityWatcher />
      {(hasEverOpened || isOpen) && (
        <>
          {isOpen && (
            <button
              type="button"
              tabIndex={-1}
              className="animate-in fade-in-0 fixed inset-0 z-50 cursor-default appearance-none border-none bg-black/50 p-0"
              onClick={closeDrawer}
            />
          )}

          <div
            className={cn(
              "bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col border-t shadow-lg",
              !isResizing &&
                "transition-[translate,height] duration-300 ease-in-out",
              isOpen ? "translate-y-0" : "translate-y-full",
            )}
            style={{ height: drawerHeight(isMaximized, drawerHeightPx) }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              title="Drag to resize, double-click to maximize"
              onPointerDown={handleResizePointerDown}
              onDoubleClick={() =>
                useTerminalStore.getState().setMaximized(!isMaximized)
              }
              className="hover:bg-primary/40 absolute inset-x-0 -top-1 h-2 cursor-row-resize"
            />
            <WorkspaceTerminal
              workspaceId={activeWorkspaceId}
              isActive={isOpen}
              toolbarClassName="px-4 pt-3"
              bodyClassName="px-4 pt-2 pb-4"
              title={
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <TerminalSquare className="size-3.5" />
                    Terminal
                  </div>
                  {activeWorkspace && (
                    <span className="text-muted-foreground text-xs">
                      {activeWorkspace.name}
                      {activeWorkspace.backend === "remote" && (
                        <span className="ml-1 text-blue-500">(remote)</span>
                      )}
                    </span>
                  )}
                </div>
              }
              extraActions={
                <>
                  <button
                    type="button"
                    onClick={() =>
                      useTerminalStore.getState().setMaximized(!isMaximized)
                    }
                    title={isMaximized ? "Restore size" : "Maximize"}
                    className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
                  >
                    {isMaximized ? (
                      <Minimize2 className="size-4" />
                    ) : (
                      <Maximize2 className="size-4" />
                    )}
                    <span className="sr-only">
                      {isMaximized ? "Restore size" : "Maximize"}
                    </span>
                  </button>
                  <span className="text-muted-foreground px-1 font-mono text-xs">
                    Ctrl+`
                  </span>
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
                  >
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                  </button>
                </>
              }
            />
          </div>
        </>
      )}
    </>
  );
}
