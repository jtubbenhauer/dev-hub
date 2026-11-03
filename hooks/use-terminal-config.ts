"use client";

import { useEffect, useState } from "react";

export interface TerminalConfig {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly shellCommand: string | null;
}

export interface TerminalConfigState {
  readonly config: TerminalConfig | null;
  readonly error: string | null;
  readonly isLoading: boolean;
}

interface ResolvedTerminalConfig {
  readonly workspaceId: string;
  readonly config: TerminalConfig | null;
  readonly error: string | null;
}

// Same request and error handling as the drawer's resolve effect.
async function fetchTerminalConfig(
  workspaceId: string,
): Promise<TerminalConfig> {
  const res = await fetch(
    `/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error || `Failed to resolve terminal (${res.status})`);
  }
  return (await res.json()) as TerminalConfig;
}

export function useTerminalConfig(workspaceId: string): TerminalConfigState {
  const [resolved, setResolved] = useState<ResolvedTerminalConfig | null>(null);

  useEffect(() => {
    let isCancelled = false;
    fetchTerminalConfig(workspaceId)
      .then((config) => {
        if (!isCancelled) setResolved({ workspaceId, config, error: null });
      })
      .catch((error: unknown) => {
        if (isCancelled) return;
        setResolved({
          workspaceId,
          config: null,
          error:
            error instanceof Error
              ? error.message
              : "Failed to resolve terminal",
        });
      });
    return () => {
      isCancelled = true;
    };
  }, [workspaceId]);

  // A result for another workspace is stale: report loading until ours lands.
  if (resolved?.workspaceId !== workspaceId) {
    return { config: null, error: null, isLoading: true };
  }
  return { config: resolved.config, error: resolved.error, isLoading: false };
}
