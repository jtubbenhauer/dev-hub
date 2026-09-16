"use client";

import { useCallback, useRef, useState } from "react";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitPull, useGitPush } from "@/hooks/use-git";

interface GitSyncControlsProps {
  workspaceId: string;
  hasDirtyTree: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
  onSuccess: () => void;
}

type SyncError = { step: "pull" | "push"; message: string };

function formatError(step: "pull" | "push", err: unknown): string {
  const prefix = step === "pull" ? "Pull failed" : "Push failed";
  if (err instanceof Error && err.message) return `${prefix}: ${err.message}`;
  return prefix;
}

export function GitSyncControls({
  workspaceId,
  hasDirtyTree,
  tracking,
  ahead,
  behind,
  onSuccess,
}: GitSyncControlsProps) {
  const pull = useGitPull(workspaceId);
  const push = useGitPush(workspaceId);
  const pullAsync = pull.mutateAsync;
  const pushAsync = push.mutateAsync;

  const [error, setError] = useState<SyncError | null>(null);

  // Synchronous latch: guards against same-tick rapid clicks. The visual
  // `isPending` disable is async (flips a render later), so a ref is the only
  // reliable barrier between two clicks fired in the same tick. Ref writes in
  // event handlers are permitted by the React Compiler.
  const inFlightRef = useRef(false);

  const anyPending = pull.isPending || push.isPending;
  const noUpstream = tracking === null;

  const runPull = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      await pullAsync({ action: "pull" });
      onSuccess();
    } catch (err) {
      setError({ step: "pull", message: formatError("pull", err) });
    } finally {
      inFlightRef.current = false;
    }
  }, [pullAsync, onSuccess]);

  const runPush = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      await pushAsync({ action: "push" });
      onSuccess();
    } catch (err) {
      setError({ step: "push", message: formatError("push", err) });
    } finally {
      inFlightRef.current = false;
    }
  }, [pushAsync, onSuccess]);

  const runSync = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    let step: "pull" | "push" = "pull";
    try {
      await pullAsync({ action: "pull" });
      onSuccess();
      step = "push";
      await pushAsync({ action: "push" });
      onSuccess();
    } catch (err) {
      setError({ step, message: formatError(step, err) });
    } finally {
      inFlightRef.current = false;
    }
  }, [pullAsync, pushAsync, onSuccess]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Pull"
            data-testid="git-pull-button"
            disabled={noUpstream || anyPending}
            onClick={runPull}
          >
            {pull.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowDownToLine className="size-3" />
            )}
            {behind > 0 && (
              <span
                className="ml-0.5 text-[10px] tabular-nums"
                data-testid="git-behind-count"
              >
                {behind}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pull{behind > 0 ? ` (${behind})` : ""}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Sync"
            data-testid="git-sync-button"
            disabled={noUpstream || hasDirtyTree || anyPending}
            onClick={runSync}
          >
            {anyPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sync (pull, then push)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Push"
            data-testid="git-push-button"
            disabled={anyPending}
            onClick={runPush}
          >
            {push.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowUpFromLine className="size-3" />
            )}
            {ahead > 0 && (
              <span
                className="ml-0.5 text-[10px] tabular-nums"
                data-testid="git-ahead-count"
              >
                {ahead}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Push{ahead > 0 ? ` (${ahead})` : ""}</TooltipContent>
      </Tooltip>

      {error && (
        <p
          className="text-destructive w-full text-xs"
          data-testid={
            error.step === "pull" ? "git-pull-error" : "git-push-error"
          }
        >
          {error.message}
        </p>
      )}
    </>
  );
}
