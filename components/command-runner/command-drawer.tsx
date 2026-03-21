"use client";

import { useEffect, useMemo } from "react";
import { Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandInput } from "./command-input";
import { CommandOutput } from "./command-output";
import { useCommandStore } from "@/stores/command-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

interface SessionTab {
  sessionId: string;
  command: string;
  isRunning: boolean;
  exitCode: number | null;
}

export function CommandDrawer() {
  const isOpen = useCommandStore((s) => s.isDrawerOpen);
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen);
  const activeSessionId = useCommandStore((s) => s.activeSessionId);
  const setActiveSessionId = useCommandStore((s) => s.setActiveSessionId);
  const runCommand = useCommandStore((s) => s.runCommand);
  const killCommand = useCommandStore((s) => s.killCommand);
  const removeSession = useCommandStore((s) => s.removeSession);
  const fetchActiveProcesses = useCommandStore((s) => s.fetchActiveProcesses);
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  // Stable reference — Zustand only notifies when the sessions object is replaced.
  const sessions = useCommandStore((s) => s.sessions);

  // Derived from sessions — only recomputes when sessions reference changes,
  // NOT on every line of output for unrelated tabs.
  const sessionTabs = useMemo(
    (): SessionTab[] =>
      Object.values(sessions).map((session) => ({
        sessionId: session.sessionId,
        command: session.command,
        isRunning: session.isRunning,
        exitCode: session.exitCode,
      })),
    [sessions],
  );

  // Derived from the already-selected sessions — no extra subscription needed.
  const activeSession = activeSessionId
    ? (sessions[activeSessionId] ?? null)
    : null;

  // Poll for active processes when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    fetchActiveProcesses();
  }, [isOpen, fetchActiveProcesses]);

  const handleNewPanel = () => {
    setActiveSessionId(null);
  };

  const handleRun = (command: string) => {
    if (!workspaceId) return;
    runCommand(command, workspaceId);
  };

  const handleKill = () => {
    if (!activeSessionId) return;
    killCommand(activeSessionId);
  };

  const handleCloseTab = (sessionId: string, isRunning: boolean) => {
    if (isRunning) {
      killCommand(sessionId);
    }
    removeSession(sessionId);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setDrawerOpen}>
      <SheetContent
        side="bottom"
        className="h-[60vh] max-h-[600px]"
        showCloseButton={false}
      >
        <SheetHeader className="pb-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm">Command Runner</SheetTitle>
            <SheetDescription className="sr-only">
              Run and manage terminal commands
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden px-4 pb-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto border-b pb-1">
            {sessionTabs.map((tab) => (
              <button
                key={tab.sessionId}
                onClick={() => setActiveSessionId(tab.sessionId)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-1.5 font-mono text-xs transition-colors",
                  tab.sessionId === activeSessionId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.isRunning && (
                  <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                )}
                <span className="max-w-32 truncate">{tab.command}</span>
                {tab.exitCode !== null && (
                  <Badge
                    variant={tab.exitCode === 0 ? "default" : "destructive"}
                    className="px-1 py-0 text-[8px]"
                  >
                    {tab.exitCode}
                  </Badge>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.sessionId, tab.isRunning);
                  }}
                  className="hover:bg-muted-foreground/20 ml-1 rounded-sm p-0.5"
                >
                  <X className="size-2.5" />
                </button>
              </button>
            ))}

            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              onClick={handleNewPanel}
            >
              <Plus className="size-3" />
            </Button>
          </div>

          {/* Active panel content */}
          {activeSession ? (
            <div className="flex flex-1 flex-col gap-2 overflow-hidden">
              <CommandInput
                workspaceId={workspaceId}
                isRunning={activeSession.isRunning}
                onRun={handleRun}
                onKill={handleKill}
              />
              <CommandOutput
                lines={activeSession.lines}
                isRunning={activeSession.isRunning}
                className="flex-1"
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-2 overflow-hidden">
              <CommandInput
                workspaceId={workspaceId}
                isRunning={false}
                onRun={handleRun}
                onKill={() => {}}
              />
              {!workspaceId && (
                <p className="text-muted-foreground py-8 text-center text-xs">
                  Select a workspace to run commands
                </p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
