"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  toOmoSessionSelection,
  type OmoSessionSelection,
} from "@/lib/chat/omo-session-selection";
import { engineForSessionId } from "@/lib/engine/types";

async function fetchOmoSessionSelection(
  workspaceId: string,
  sessionId: string,
): Promise<OmoSessionSelection | null> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(
    `/api/opencode/session/${encodeURIComponent(sessionId)}/selection?${params}`,
  );
  if (!response.ok) return null;
  return toOmoSessionSelection(await response.json());
}

export function useOmoSessionSelection(
  workspaceId: string | null,
  sessionId: string | null,
): OmoSessionSelection | null {
  const isEnabled =
    workspaceId !== null &&
    sessionId !== null &&
    engineForSessionId(sessionId) === "omo";
  const { data } = useQuery({
    queryKey: ["omo-session-selection", workspaceId, sessionId],
    queryFn: isEnabled
      ? () => fetchOmoSessionSelection(workspaceId, sessionId)
      : skipToken,
  });
  return isEnabled ? (data ?? null) : null;
}
