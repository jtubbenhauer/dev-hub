"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  TerminalPanel,
  type TerminalHandle,
} from "@/components/terminal/terminal-panel";
import {
  useNvimAppNameSetting,
  useTerminalScrollbackSetting,
  useTerminalFontSetting,
  terminalFontFamily,
} from "@/hooks/use-settings";
import { Loader2, AlertCircle } from "lucide-react";

interface NeovimEditorProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
  autoFocus?: boolean;
}

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

const NVIM_SESSION_ID = "nvim-file-editor";

interface DepsStatus {
  nvim: boolean;
}

async function checkNvimInstalled(): Promise<boolean> {
  const res = await fetch("/api/terminal/deps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check-deps" }),
  });
  if (!res.ok) {
    throw new Error("Failed to check dependencies");
  }
  const deps = (await res.json()) as DepsStatus;
  return deps.nvim;
}

function escapeShellSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''");
}

export function NeovimEditor({ workspaceId, filePath, autoFocus = false }: NeovimEditorProps) {
  const { nvimAppName } = useNvimAppNameSetting();
  const { scrollback } = useTerminalScrollbackSetting();
  const { terminalFont } = useTerminalFontSetting();
  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [depsChecked, setDepsChecked] = useState(false);
  const resolvedWorkspaceRef = useRef<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const terminalHandleRef = useRef<TerminalHandle | null>(null);
  const desiredFileRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkNvimInstalled()
      .then((hasNvim) => {
        if (cancelled) return;
        if (!hasNvim) {
          setError(
            "Neovim is not installed. Install it (e.g. `brew install neovim`) or change editor type in Settings.",
          );
        }
        setDepsChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDepsChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    if (resolvedWorkspaceRef.current === workspaceId && terminalConfig) return;

    setIsResolving(true);
    setError(null);
    resolvedWorkspaceRef.current = workspaceId;

    fetch(
      `/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`,
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
      .then((config) => {
        setTerminalConfig(config);
        setIsResolving(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsResolving(false);
      });
  }, [workspaceId, terminalConfig]);

  // Switch files by writing nvim commands directly through the PTY
  useEffect(() => {
    if (!filePath || !terminalConfig || isResolving) return;

    // Always track what file we want, even if handle isn't ready yet
    desiredFileRef.current = filePath;

    if (currentFileRef.current === filePath) return;

    const handle = terminalHandleRef.current;
    if (!handle) return;

    currentFileRef.current = filePath;
    // Escape to normal mode, then open the new file after a brief delay
    handle.write("\x1b");
    setTimeout(() => handle.write(`:e ${filePath}\r`), 50);
  }, [filePath, terminalConfig, isResolving]);

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalHandleRef.current = handle;

    // If a file switch was requested before the handle was ready, apply it now
    const desired = desiredFileRef.current;
    if (desired && desired !== currentFileRef.current) {
      currentFileRef.current = desired;
      handle.write("\x1b");
      setTimeout(() => handle.write(`:e ${desired}\r`), 50);
    }
  }, []);

  if (!workspaceId || !filePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <span>
          {!workspaceId
            ? "No workspace selected — neovim editor requires a workspace"
            : "No file selected — neovim editor requires a file path"}
        </span>
      </div>
    );
  }

  if (isResolving || !depsChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }

  if (!terminalConfig) return null;

  const nvimEnv: Record<string, string> = {};
  if (nvimAppName && nvimAppName !== "personal") {
    nvimEnv.NVIM_APPNAME = nvimAppName;
  }

  const shellCommand = `nvim '${escapeShellSingleQuote(filePath)}'`;

  return (
    <div className="h-full min-h-0 min-w-0">
      <TerminalPanel
        wsUrl={terminalConfig.wsUrl}
        workspaceId={workspaceId}
        cwd={terminalConfig.cwd}
        shellCommand={shellCommand}
        scrollback={scrollback}
        sessionId={NVIM_SESSION_ID}
        envOverrides={Object.keys(nvimEnv).length > 0 ? nvimEnv : undefined}
        onReady={handleTerminalReady}
        fontFamily={terminalFontFamily(terminalFont)}
        autoFocus={autoFocus}
      />
    </div>
  );
}
