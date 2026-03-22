"use client";

import { useEffect, useState } from "react";
import { TerminalPanel } from "./terminal-panel";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useTerminalScrollbackSetting,
  useTerminalFontSetting,
  terminalFontFamily,
} from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { Loader2, AlertCircle, TerminalSquare, X } from "lucide-react";

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

export function TerminalDrawer() {
  const isOpen = useTerminalStore((s) => s.isOpen);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const toggle = useTerminalStore((s) => s.toggle);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const { scrollback } = useTerminalScrollbackSetting();
  const { terminalFont } = useTerminalFontSetting();

  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(
    null,
  );
  const [hasEverOpened, setHasEverOpened] = useState(false);

  // Track if the drawer has ever opened (during render)
  if (isOpen && !hasEverOpened) {
    setHasEverOpened(true);
  }

  // Detect workspace change during render and reset to loading state
  const isNewWorkspace = activeWorkspaceId !== resolvedWorkspaceId;
  const needsFetch =
    isOpen && !!activeWorkspaceId && (isNewWorkspace || (!config && !error));
  if (needsFetch && !isLoading) {
    setIsLoading(true);
    setError(null);
    setConfig(null);
    setResolvedWorkspaceId(activeWorkspaceId);
  }

  useEffect(() => {
    if (!isOpen || !activeWorkspaceId) return;
    if (!isLoading) return;

    let cancelled = false;

    fetch(
      `/api/terminal/resolve?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(
            body.error || `Failed to resolve terminal (${res.status})`,
          );
        }
        return res.json() as Promise<TerminalConfig>;
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setIsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeWorkspaceId, isLoading]);

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
        toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  if (!hasEverOpened && !isOpen) return null;

  return (
    <>
      {isOpen && (
        <button
          type="button"
          tabIndex={-1}
          className="animate-in fade-in-0 fixed inset-0 z-50 cursor-default appearance-none border-none bg-black/50 p-0"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={cn(
          "bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col border-t shadow-lg transition-transform duration-300 ease-in-out",
          "h-[60vh] max-h-[600px]",
          isOpen ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">
              Ctrl+`
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-4 pb-4">
          {!activeWorkspaceId && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-muted-foreground text-sm">
                Select a workspace to open a terminal
              </p>
            </div>
          )}

          {activeWorkspaceId && isLoading && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}

          {activeWorkspaceId && error && (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                <AlertCircle className="text-muted-foreground size-8" />
                <p className="text-muted-foreground text-sm">{error}</p>
              </div>
            </div>
          )}

          {isOpen && activeWorkspaceId && config && !isLoading && !error && (
            <div className="min-h-0 flex-1">
              <TerminalPanel
                key={resolvedWorkspaceId}
                wsUrl={config.wsUrl}
                workspaceId={activeWorkspaceId}
                cwd={config.cwd}
                shellCommand={config.shellCommand}
                scrollback={scrollback}
                fontFamily={terminalFontFamily(terminalFont)}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
