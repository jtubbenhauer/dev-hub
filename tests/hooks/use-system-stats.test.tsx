import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_SUMMARY_QUERY_KEY,
  useSystemStatsSnapshot,
  useSystemStatsWithHistory,
  useSystemSummary,
} from "@/hooks/use-system-stats";
import type { SystemStats, SystemSummary } from "@/types";

function makeSummary(cpuUsage: number): SystemSummary {
  return {
    cpu: { usage: cpuUsage, cores: 8, model: "Apple M2", speed: 3.5 },
    memory: {
      total: 16,
      used: 4,
      free: 12,
      usagePercent: 25,
      swapTotal: 0,
      swapUsed: 0,
      swapPercent: 0,
    },
    uptime: 100,
    timestamp: cpuUsage,
  };
}

function makeFullStats(cpuUsage: number): SystemStats {
  return {
    ...makeSummary(cpuUsage),
    disks: [],
    network: [{ iface: "en0", rxSec: 1, txSec: 2 }],
    processes: [],
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, wrapper: QueryWrapper };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSystemSummary", () => {
  it("fetches the summary endpoint under the summary key", async () => {
    const fetchMock = vi.fn(async () => Response.json(makeSummary(10)));
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => useSystemSummary({ interval: 30_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual(makeSummary(10)));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/system?detail=summary",
    );
    expect(SYSTEM_SUMMARY_QUERY_KEY).toEqual([
      "system-stats",
      { detail: "summary" },
    ]);
    expect(queryClient.getQueryData(SYSTEM_SUMMARY_QUERY_KEY)).toEqual(
      makeSummary(10),
    );
  });
});

describe("full system stats fetches", () => {
  it("fill the summary cache from a snapshot without extra requests", async () => {
    const fetchMock = vi.fn(async () => Response.json(makeFullStats(42)));
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => useSystemStatsSnapshot({ interval: 5_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(queryClient.getQueryData(SYSTEM_SUMMARY_QUERY_KEY)).toEqual(
      makeSummary(42),
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/system?");
  });

  it("keep a mounted summary as live as the dashboard history query", async () => {
    let fullCpuUsage = 50;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/system?detail=summary")
        return Response.json(makeSummary(10));
      return Response.json({
        current: makeFullStats(fullCpuUsage),
        history: {
          timestamps: [],
          cpu: [],
          memory: [],
          networkTimestamps: [],
          networkRx: [],
          networkTx: [],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, wrapper } = createWrapper();

    const { result: summaryResult } = renderHook(
      () => useSystemSummary({ interval: 30_000 }),
      { wrapper },
    );
    await waitFor(() => expect(summaryResult.current.data?.cpu.usage).toBe(10));

    const { result: fullResult } = renderHook(
      () => useSystemStatsWithHistory({ interval: 5_000 }),
      { wrapper },
    );
    await waitFor(() => expect(fullResult.current.data).toBeDefined());
    await waitFor(() => expect(summaryResult.current.data?.cpu.usage).toBe(50));

    fullCpuUsage = 77;
    await act(() =>
      queryClient.refetchQueries({
        queryKey: ["system-stats", { history: true }],
      }),
    );
    await waitFor(() => expect(summaryResult.current.data?.cpu.usage).toBe(77));
    expect(summaryResult.current.data).not.toHaveProperty("processes");
    const summaryRequests = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/system?detail=summary",
    );
    expect(summaryRequests).toHaveLength(1);
  });
});
