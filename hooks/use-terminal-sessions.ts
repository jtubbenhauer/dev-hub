"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";

const TERMINAL_SESSIONS_QUERY_KEY = ["terminal-sessions"] as const;

async function fetchTerminalSessions(): Promise<TerminalSessionInfo[]> {
  const res = await fetch("/api/terminal/sessions");
  if (!res.ok) throw new Error(`Failed to list terminals (${res.status})`);
  const body = (await res.json()) as { sessions?: TerminalSessionInfo[] };
  return body.sessions ?? [];
}

function sessionUrl(workspaceId: string, sessionId: string): string {
  return `/api/terminal/sessions/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sessionId)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function useTerminalSessions(options: {
  isEnabled: boolean;
  refetchIntervalMs: number;
}) {
  return useQuery({
    queryKey: TERMINAL_SESSIONS_QUERY_KEY,
    queryFn: fetchTerminalSessions,
    enabled: options.isEnabled,
    refetchInterval: options.refetchIntervalMs,
    staleTime: 1000,
  });
}

export function useSetTerminalPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      sessionId: string;
      isPinned: boolean;
    }) => {
      const res = await fetch(sessionUrl(input.workspaceId, input.sessionId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: input.isPinned }),
      });
      if (!res.ok)
        throw new Error(await readError(res, "Failed to update terminal"));
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: TERMINAL_SESSIONS_QUERY_KEY }),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useEndTerminalSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { workspaceId: string; sessionId: string }) => {
      const res = await fetch(sessionUrl(input.workspaceId, input.sessionId), {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error(await readError(res, "Failed to end terminal"));
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: TERMINAL_SESSIONS_QUERY_KEY }),
    onError: (err: Error) => toast.error(err.message),
  });
}
