"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { IDockviewPanelProps } from "dockview-react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { TerminalHandle } from "@/components/terminal/terminal-panel";
import { useWorkbenchPanelState } from "@/components/workbench/use-workbench-panel-state";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import {
  terminalFontFamily,
  useTerminalFontSetting,
  useTerminalScrollbackSetting,
} from "@/hooks/use-settings";
import { useTerminalConfig } from "@/hooks/use-terminal-config";
import { useTerminalSessions } from "@/hooks/use-terminal-sessions";
import { terminalSessionKey } from "@/lib/terminal/terminal-protocol";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

const TerminalPanel = dynamic(() =>
  import("@/components/terminal/terminal-panel").then(
    (mod) => mod.TerminalPanel,
  ),
);

// 0 = never reap: a workbench shell lives until its tab is closed, even while
// detached (another route, another workspace).
const WORKBENCH_TERMINAL_IDLE_TIMEOUT_MINUTES = 0;
const RUNNING_COMMAND_POLL_INTERVAL_MS = 4000;

type TerminalTabParams = Extract<WorkbenchTabParams, { kind: "terminal" }>;

interface TerminalTabBodyProps {
  readonly params: TerminalTabParams;
  readonly isFocused: boolean;
}

function TerminalTabBody({ params, isFocused }: TerminalTabBodyProps) {
  const { workspaceId, sessionId } = params;
  const { config, error } = useTerminalConfig(workspaceId);
  const { scrollback, isLoading: isScrollbackLoading } =
    useTerminalScrollbackSetting();
  const { terminalFont, isLoading: isFontLoading } = useTerminalFontSetting();
  const terminalHandleRef = useRef<TerminalHandle | null>(null);

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalHandleRef.current = handle;
  }, []);

  // Next frame: the tab's own mousedown focus and dockview's overlay reveal land first.
  useEffect(() => {
    if (!isFocused) return;
    const frame = requestAnimationFrame(() =>
      terminalHandleRef.current?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [isFocused]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <AlertCircle aria-hidden className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Waiting for the settings too avoids a reconnect once they arrive.
  if (!config || isScrollbackLoading || isFontLoading) {
    return (
      <div
        role="status"
        aria-label="Loading terminal"
        className="flex h-full items-center justify-center"
      >
        <Loader2
          aria-hidden
          className="text-muted-foreground size-5 animate-spin"
        />
      </div>
    );
  }

  return (
    <TerminalPanel
      key={terminalSessionKey(workspaceId, sessionId)}
      wsUrl={config.wsUrl}
      cwd={config.cwd}
      shellCommand={config.shellCommand}
      workspaceId={workspaceId}
      sessionId={sessionId}
      scrollback={scrollback}
      fontFamily={terminalFontFamily(terminalFont)}
      idleTimeoutMinutes={WORKBENCH_TERMINAL_IDLE_TIMEOUT_MINUTES}
      hasShellFeatures
      autoFocus={isFocused}
      onReady={handleTerminalReady}
    />
  );
}

export function TerminalTabPanel({
  api,
  containerApi,
  params,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  const { isFocused } = useWorkbenchPanelState(api, containerApi);
  return (
    <WorkbenchPanelFrame api={api}>
      {params.kind === "terminal" ? (
        <TerminalTabBody params={params} isFocused={isFocused} />
      ) : null}
    </WorkbenchPanelFrame>
  );
}

interface TerminalTabRunningIndicatorProps {
  readonly workspaceId: string;
  readonly sessionId: string;
}

// Tab-header spinner while the shell runs a foreground command.
export function TerminalTabRunningIndicator({
  workspaceId,
  sessionId,
}: TerminalTabRunningIndicatorProps) {
  const { data: sessions } = useTerminalSessions({
    isEnabled: true,
    refetchIntervalMs: RUNNING_COMMAND_POLL_INTERVAL_MS,
  });
  const runningCommand =
    sessions?.find(
      (session) =>
        session.workspaceId === workspaceId && session.sessionId === sessionId,
    )?.runningCommand ?? null;
  if (runningCommand === null) return null;
  return (
    <Loader2
      role="img"
      aria-label={`Running ${runningCommand}`}
      className="size-3 shrink-0 animate-spin opacity-70 motion-reduce:animate-none"
    />
  );
}
