"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SystemStats,
  SystemStatsWithHistory,
  SystemSummary,
} from "@/types";

interface UseSystemStatsOptions {
  interval?: number;
  history?: boolean;
  enabled?: boolean;
}

interface UseSystemSummaryOptions {
  interval?: number;
  enabled?: boolean;
}

export const SYSTEM_SUMMARY_QUERY_KEY = [
  "system-stats",
  { detail: "summary" },
] as const;

async function fetchSystemStats(
  history: boolean,
): Promise<SystemStats | SystemStatsWithHistory> {
  const params = new URLSearchParams();
  if (history) params.set("history", "true");

  const res = await fetch(`/api/system?${params}`);
  if (!res.ok) throw new Error("Failed to fetch system stats");
  return res.json();
}

async function fetchSystemSummary(): Promise<SystemSummary> {
  const res = await fetch("/api/system?detail=summary");
  if (!res.ok) throw new Error("Failed to fetch system stats");
  return res.json();
}

function toSystemSummary(
  data: SystemStats | SystemStatsWithHistory,
): SystemSummary {
  const stats = "current" in data ? data.current : data;
  return {
    cpu: stats.cpu,
    memory: stats.memory,
    uptime: stats.uptime,
    timestamp: stats.timestamp,
  };
}

export function useSystemStats(options: UseSystemStatsOptions = {}) {
  const { interval = 15_000, history = false, enabled = true } = options;
  const queryClient = useQueryClient();

  return useQuery<SystemStats | SystemStatsWithHistory>({
    queryKey: ["system-stats", { history }],
    queryFn: async () => {
      const data = await fetchSystemStats(history);
      // Keeps the header's summary as live as the dashboard without another request.
      queryClient.setQueryData<SystemSummary>(
        SYSTEM_SUMMARY_QUERY_KEY,
        toSystemSummary(data),
      );
      return data;
    },
    refetchInterval: interval,
    enabled,
    staleTime: interval / 2,
  });
}

export function useSystemSummary(options: UseSystemSummaryOptions = {}) {
  const { interval = 15_000, enabled = true } = options;

  return useQuery<SystemSummary>({
    queryKey: SYSTEM_SUMMARY_QUERY_KEY,
    queryFn: fetchSystemSummary,
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
