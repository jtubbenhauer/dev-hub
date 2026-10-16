import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOmoSessionSelection } from "@/hooks/use-omo-session-selection";

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

describe("useOmoSessionSelection", () => {
  it("loads an omo chat's own model and thinking level", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            model: {
              providerID: "anthropic-subscription",
              modelID: "claude-haiku-5-5",
            },
            variant: "high",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useOmoSessionSelection("ws-1", "omo_1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        model: {
          providerID: "anthropic-subscription",
          modelID: "claude-haiku-5-5",
        },
        variant: "high",
      }),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/opencode/session/omo_1/selection?workspaceId=ws-1",
    ]);
  });

  it("drops fields that are missing or malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ model: { providerID: "p" }, variant: 3 }),
            { status: 200 },
          ),
      ),
    );

    const { result } = renderHook(
      () => useOmoSessionSelection("ws-1", "omo_1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(result.current).toEqual({ model: null, variant: null }),
    );
  });

  it("treats a failed read as no selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    const { result } = renderHook(
      () => useOmoSessionSelection("ws-1", "omo_1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("never asks about an OpenCode chat", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useOmoSessionSelection("ws-1", "ses_1"),
      { wrapper: createWrapper() },
    );

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
