import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { useAgentHealth } from "@/hooks/use-git";
import { useWorkspaceResume } from "@/hooks/use-workspace-resume";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe("useAgentHealth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns suspended when health API reports suspended", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "suspended" }),
    });

    const { result } = renderHook(() => useAgentHealth("ws-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe("suspended"));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/health");
  });
});

describe("useWorkspaceResume", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("posts to start endpoint and shows start/completion toasts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "started" }),
    });

    const { result } = renderHook(() => useWorkspaceResume("ws-1"), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.resume();
    });

    expect(result.current.isResuming).toBe(true);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      "Resuming workspace...",
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/start", {
      method: "POST",
    });

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        "Workspace resumed",
      );
      expect(result.current.isResuming).toBe(false);
    });
  });

  it("deduplicates concurrent resume calls client-side", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    mockFetch.mockImplementationOnce(() => pendingFetch);

    const { result } = renderHook(() => useWorkspaceResume("ws-2"), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.resume();
      result.current.resume();
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => ({ status: "started" }),
    });

    await waitFor(() => expect(result.current.isResuming).toBe(false));
  });
});
