"use client";

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
import {
  Check,
  ChevronRight,
  Loader2,
  PanelLeft,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewFile } from "@/types";

export interface NeovimReviewEditorHandle {
  focus: () => void;
  blur: () => void;
}

interface NeovimReviewEditorProps {
  fileContent: {
    original: string;
    current: string;
    path: string;
    language: string;
  };
  file?: ReviewFile;
  workspaceId: string;
  isLoading: boolean;
  onToggleReviewed?: (file: ReviewFile) => void;
  onMarkAndNext?: (file: ReviewFile) => void;
  onOpenFileList?: () => void;
}

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

const NVIM_SESSION_ID = "nvim-editor";

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

export const NeovimReviewEditor = forwardRef<
  NeovimReviewEditorHandle,
  NeovimReviewEditorProps
>(function NeovimReviewEditor(
  {
    fileContent,
    file,
    workspaceId,
    isLoading,
    onToggleReviewed,
    onMarkAndNext,
    onOpenFileList,
  },
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
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const currentFileRef = useRef<string | null>(null);
  const terminalHandleRef = useRef<TerminalHandle | null>(null);
  const desiredFileRef = useRef<string | null>(null);

  // Track workspace changes and set loading state (during render)
  const isNewWorkspace = resolvedWorkspaceId !== workspaceId;
  const needsResolve = isNewWorkspace || (!terminalConfig && !error);
  if (needsResolve && !isResolving) {
    setIsResolving(true);
    setError(null);
    setResolvedWorkspaceId(workspaceId);
  }

  useImperativeHandle(
    ref,
    () => ({
      focus: () => terminalHandleRef.current?.focus(),
      blur: () => terminalHandleRef.current?.blur(),
    }),
    [],
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

  useEffect(() => {
    if (!isResolving) return;

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
  }, [isResolving, workspaceId]);

  // Switch files by writing nvim commands directly through the PTY
  useEffect(() => {
    if (!fileContent.path || !terminalConfig || isResolving) return;

    // Always track what file we want, even if handle isn't ready yet
    desiredFileRef.current = fileContent.path;

    if (currentFileRef.current === fileContent.path) return;

    const handle = terminalHandleRef.current;
    if (!handle) return;

    currentFileRef.current = fileContent.path;
    // Escape to normal mode, then open the new file after a brief delay
    handle.write("\x1b");
    setTimeout(() => {
      handle.write(`:e ${fileContent.path}\r`);
    }, 50);
  }, [fileContent.path, terminalConfig, isResolving]);

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalHandleRef.current = handle;

    // If a file switch was requested before the handle was ready, apply it now
    const desired = desiredFileRef.current;
    if (desired && desired !== currentFileRef.current) {
      currentFileRef.current = desired;
      handle.write("\x1b");
      setTimeout(() => {
        handle.write(`:e ${desired}\r`);
      }, 50);
    }
  }, []);

  if (isLoading || isResolving || !depsChecked) {
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

  const fileName = fileContent.path.split("/").pop() ?? fileContent.path;

  const nvimEnv: Record<string, string> = {};
  if (nvimAppName && nvimAppName !== "personal") {
    nvimEnv.NVIM_APPNAME = nvimAppName;
  }

  const shellCommand = `nvim '${escapeShellSingleQuote(fileContent.path)}'`;

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="bg-muted/30 flex shrink-0 items-center gap-1.5 overflow-hidden border-b px-2 py-1.5 md:gap-2 md:px-3">
        {onOpenFileList && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 md:hidden"
            onClick={onOpenFileList}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>
        )}

        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
          {fileName}
        </span>

        {file && onToggleReviewed && (
          <Button
            variant={file.reviewed ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs md:px-2"
            onClick={() => onToggleReviewed(file)}
          >
            <Check className="h-3.5 w-3.5" />
            <span className="hidden md:inline">
              {file.reviewed ? "Reviewed" : "Mark reviewed"}
            </span>
          </Button>
        )}

        {file && onMarkAndNext && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs md:px-2"
            onClick={() => onMarkAndNext(file)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Next</span>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
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
          autoFocus={true}
        />
      </div>
    </div>
  );
});
