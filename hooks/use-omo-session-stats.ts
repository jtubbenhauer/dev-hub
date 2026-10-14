"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { engineForSessionId } from "@/lib/engine/types";
import type { OmoSessionStats } from "@/lib/chat/omo-session-stats";
import { useChatStore } from "@/stores/chat-store";

const BUSY_REFRESH_MS = 5_000;

async function fetchOmoSessionStats(
  workspaceId: string,
  sessionId: string,
): Promise<OmoSessionStats | null> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(
    `/api/opencode/session/${encodeURIComponent(sessionId)}/stats?${params}`,
  );
  if (!response.ok) return null;
  return (await response.json()) as OmoSessionStats | null;
}

export function useOmoSessionStats(
  workspaceId: string | null,
  sessionId: string | null,
): OmoSessionStats | null {
  const statusType = useChatStore((state) =>
    workspaceId && sessionId
      ? state.workspaceStates[workspaceId]?.sessionStatuses[sessionId]?.type
      : undefined,
  );
  const isEnabled =
    workspaceId !== null &&
    sessionId !== null &&
    engineForSessionId(sessionId) === "omo";
  const isBusy = statusType === "busy" || statusType === "retry";
  const { data } = useQuery({
    // The status is part of the key so a turn finishing refetches at once.
    queryKey: ["omo-session-stats", workspaceId, sessionId, statusType],
    queryFn: isEnabled
      ? () => fetchOmoSessionStats(workspaceId, sessionId)
      : skipToken,
    staleTime: BUSY_REFRESH_MS,
    refetchInterval: isBusy ? BUSY_REFRESH_MS : false,
    placeholderData: (previous) => previous,
  });
  return isEnabled ? (data ?? null) : null;
}
