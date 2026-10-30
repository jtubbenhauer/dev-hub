"use client";

import { Pin, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalTab } from "@/stores/terminal-store";

export interface TerminalTabStatus {
  hasActivity: boolean;
  isPinned: boolean;
  runningCommand: string | null;
}

interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeSessionId: string | null;
  statusBySessionId: Record<string, TerminalTabStatus>;
  onSelect: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
  onAdd: () => void;
}

export function TerminalTabBar({
  tabs,
  activeSessionId,
  statusBySessionId,
  onSelect,
  onEnd,
  onAdd,
}: TerminalTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Terminal sessions"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const status = statusBySessionId[tab.sessionId];
        const isActive = tab.sessionId === activeSessionId;
        return (
          <div
            key={tab.sessionId}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 border-transparent",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.sessionId)}
              className="flex items-center gap-1.5"
            >
              {status?.hasActivity && !isActive && (
                <span
                  className="size-1.5 rounded-full bg-blue-500"
                  aria-label="New output"
                />
              )}
              {status?.isPinned && (
                <Pin className="size-3" aria-label="Kept alive" />
              )}
              <span>{tab.title}</span>
              {status?.runningCommand && (
                <span className="text-muted-foreground font-mono">
                  · {status.runningCommand}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onEnd(tab.sessionId)}
              title="End session"
              aria-label={`End ${tab.title}`}
              className="rounded-sm opacity-50 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        title="New terminal"
        aria-label="New terminal"
        className="text-muted-foreground hover:bg-accent shrink-0 rounded-sm p-1"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
