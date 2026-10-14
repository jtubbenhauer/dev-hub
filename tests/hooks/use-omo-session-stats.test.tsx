import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOmoSessionStats } from "@/hooks/use-omo-session-stats";
import type { OmoSessionStats } from "@/lib/chat/omo-session-stats";

const STATS: OmoSessionStats = {
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
  cost: 0.01,
  contextUsage: null,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return QueryWrapper;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOmoSessionStats", () => {
  it("loads stats for an omo chat without asking for the workspace's engine", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify(STATS), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOmoSessionStats("ws-1", "omo_1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toEqual(STATS));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/opencode/session/omo_1/stats?workspaceId=ws-1",
    ]);
  });

  it("never asks for stats of an OpenCode chat", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOmoSessionStats("ws-1", "ses_1"), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
