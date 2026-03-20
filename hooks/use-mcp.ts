"use client"

import { useQuery } from "@tanstack/react-query"
import { useWorkspaceStore } from "@/stores/workspace-store"

export type McpStatusValue =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export type McpStatusMap = Record<string, McpStatusValue>

async function fetchMcpStatus(workspaceId: string): Promise<McpStatusMap> {
  const params = new URLSearchParams({ workspaceId })
  const res = await fetch(`/api/opencode/mcp?${params.toString()}`)
  if (!res.ok) throw new Error("Failed to fetch MCP status")
  return res.json() as Promise<McpStatusMap>
}

export function useMcpStatus() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)

  return useQuery<McpStatusMap, Error>({
    queryKey: ["opencode", "mcp", activeWorkspaceId],
    queryFn: () => fetchMcpStatus(activeWorkspaceId!),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: activeWorkspaceId != null,
  })
}
