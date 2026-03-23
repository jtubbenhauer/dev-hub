"use client";

import { useQuery } from "@tanstack/react-query";
import type { SystemStats, SystemStatsWithHistory } from "@/types";

interface UseSystemStatsOptions {
  interval?: number;
  history?: boolean;
  enabled?: boolean;
}

async function fetchSystemStats(
  history: boolean,
): Promise<SystemStats | SystemStatsWithHistory> {
  const params = new URLSearchParams();
  if (history) params.set("history", "true");

  const res = await fetch(`/api/system?${params}`);
  if (!res.ok) throw new Error("Failed to fetch system stats");
  return res.json();
}

export function useSystemStats(options: UseSystemStatsOptions = {}) {
  const { interval = 15_000, history = false, enabled = true } = options;

  return useQuery<SystemStats | SystemStatsWithHistory>({
    queryKey: ["system-stats", { history }],
    queryFn: () => fetchSystemStats(history),
    refetchInterval: interval,
    enabled,
    staleTime: interval / 2,
  });
}

// Typed convenience wrappers

export function useSystemStatsSnapshot(
  options: Omit<UseSystemStatsOptions, "history"> = {},
) {
  const result = useSystemStats({ ...options, history: false });
  return {
    ...result,
    data: result.data as SystemStats | undefined,
  };
}

export function useSystemStatsWithHistory(
  options: Omit<UseSystemStatsOptions, "history"> = {},
) {
  const result = useSystemStats({ ...options, history: true });
  return {
    ...result,
    data: result.data as SystemStatsWithHistory | undefined,
  };
}
