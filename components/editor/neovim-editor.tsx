"use client";

// allow: SIZE_OK — Terminal resolution and workspace-owned delivery share this editor lifecycle.

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
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
import type { EditorRevealRequest } from "@/stores/editor-store";
import {
  buildNeovimRevealCommand,
  hasControlCharacter,
} from "@/components/editor/neovim-reveal-command";

export interface NeovimEditorHandle {
  focus: () => void;
  blur: () => void;
  revealLine: (line: number) => void;
}

interface NeovimEditorProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
  autoFocus?: boolean;
  readonly revealRequest?: EditorRevealRequest | null;
  readonly onRevealHandled?: (id: number) => void;
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

export const NeovimEditor = forwardRef<NeovimEditorHandle, NeovimEditorProps>(
  function NeovimEditor(
    { workspaceId, filePath, autoFocus = true, revealRequest, onRevealHandled },
    ref,
  ) {
    const { nvimAppName } = useNvimAppNameSetting();
    const { scrollback } = useTerminalScrollbackSetting();
    const { terminalFont } = useTerminalFontSetting();
    const [terminalConfig, setTerminalConfig] = useState<TerminalConfig | null>(
      null,
    );
    const [error, setError] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(false);
    const [depsChecked, setDepsChecked] = useState(false);
    const currentFileRef = useRef<string | null>(null);
    // Identity also rejects an old onReady callback after switching away and back.
    const [terminal, setTerminal] = useState<{
      readonly session: { readonly workspaceId: string | undefined };
      readonly handle: TerminalHandle | null;
    }>(() => ({ session: { workspaceId }, handle: null }));
    if (terminal.session.workspaceId !== workspaceId) {
      setTerminal({ session: { workspaceId }, handle: null });
    }
    const workspaceSession = terminal.session;
    const terminalHandle =
      !isResolving && workspaceSession.workspaceId === workspaceId
        ? terminal.handle
        : null;
    const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revealRequestRef = useRef(revealRequest);
    const onRevealHandledRef = useRef(onRevealHandled);
    useEffect(() => {
      revealRequestRef.current = revealRequest;
    }, [revealRequest]);
    useEffect(() => {
      onRevealHandledRef.current = onRevealHandled;
    }, [onRevealHandled]);

    useEffect(() => {
      return () => {
        currentFileRef.current = null;
        for (const timerRef of [switchTimerRef, revealTimerRef, lineTimerRef]) {
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [workspaceSession, isResolving, terminalHandle]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => terminalHandle?.focus(),
        blur: () => terminalHandle?.blur(),
        revealLine: (line: number) => {
          if (!terminalHandle) return;
          if (!Number.isInteger(line) || line < 1) return;
          if (lineTimerRef.current !== null) clearTimeout(lineTimerRef.current);
          terminalHandle.write("\x1b");
          lineTimerRef.current = setTimeout(() => {
            lineTimerRef.current = null;
            terminalHandle.write(`:${line}\r`);
          }, 50);
        },
      }),
      [terminalHandle],
    );

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

    const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<
      string | null
    >(null);

    // Detect workspace change during render and reset to resolving state
    if (
      workspaceId &&
      (workspaceId !== resolvedWorkspaceId || !terminalConfig) &&
      !isResolving
    ) {
      setIsResolving(true);
      setError(null);
      setResolvedWorkspaceId(workspaceId);
    }

    useEffect(() => {
      if (!workspaceId || !isResolving) return;

      let cancelled = false;

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
          if (!cancelled) {
            setTerminalConfig(config);
            setIsResolving(false);
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setError(err.message);
            setIsResolving(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [workspaceId, isResolving]);

    // Switch files by writing nvim commands directly through the PTY
    useEffect(() => {
      if (
        !filePath ||
        !terminalConfig ||
        isResolving ||
        !workspaceId ||
        !terminalHandle
      )
        return;
      if (currentFileRef.current === filePath) return;
      // Escape to normal mode, then open the new file after a brief delay
      const canWritePath = !hasControlCharacter(filePath);
      if (canWritePath) terminalHandle.write("\x1b");
      switchTimerRef.current = setTimeout(() => {
        switchTimerRef.current = null;
        currentFileRef.current = filePath;
        const request = revealRequestRef.current;
        if (request?.path === filePath && request.workspaceId === workspaceId) {
          const command = buildNeovimRevealCommand(request);
          if (canWritePath)
            terminalHandle.write(
              command !== null ? `:${command}\r` : `:e ${filePath}\r`,
            );
          onRevealHandledRef.current?.(request.id);
        } else if (canWritePath) {
          terminalHandle.write(`:e ${filePath}\r`);
        }
        if (canWritePath) terminalHandle.focus();
      }, 50);
      return () => {
        if (switchTimerRef.current !== null)
          clearTimeout(switchTimerRef.current);
        switchTimerRef.current = null;
      };
    }, [filePath, terminalConfig, isResolving, terminalHandle, workspaceId]);

    useEffect(() => {
      if (
        !revealRequest ||
        revealRequest.path !== filePath ||
        revealRequest.workspaceId !== workspaceId ||
        isResolving ||
        !terminalHandle ||
        currentFileRef.current !== filePath ||
        switchTimerRef.current !== null
      )
        return;
      if (!hasControlCharacter(revealRequest.path))
        terminalHandle.write("\x1b");
      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null;
        const command = buildNeovimRevealCommand(revealRequest);
        if (command !== null) terminalHandle.write(`:${command}\r`);
        onRevealHandledRef.current?.(revealRequest.id);
      }, 50);
      return () => {
        if (revealTimerRef.current !== null)
          clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      };
    }, [revealRequest, terminalHandle, filePath, workspaceId, isResolving]);

    const handleTerminalReady = useCallback(
      (handle: TerminalHandle) => {
        if (isResolving) return;
        setTerminal((current) =>
          current.session === workspaceSession
            ? { ...current, handle }
            : current,
        );
      },
      [workspaceSession, isResolving],
    );

    if (!workspaceId || !filePath) {
      return (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
          <AlertCircle className="text-destructive h-6 w-6" />
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
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
          <AlertCircle className="text-destructive h-6 w-6" />
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
  },
);
