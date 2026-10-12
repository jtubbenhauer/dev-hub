import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitStatus } from "@/hooks/use-git";

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

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useGitStatus polling", () => {
  it("fetches at mount, not at 10 s, and again at 30 s by default", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ branch: "main", files: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useGitStatus("ws-1"), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/git?action=status",
    );

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
