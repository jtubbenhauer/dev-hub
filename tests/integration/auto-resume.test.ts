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

  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }) {
      return createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("auto-resume integration flow", () => {
  it("health hook returns suspended when API reports suspended", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "suspended" }),
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAgentHealth("ws-1", true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toBe("suspended"));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/health");
  });

  it("resume hook calls start API and invalidates health query", async () => {
    const { queryClient, Wrapper } = createWrapper();

    queryClient.setQueryData(["agent-health", "ws-1"], "suspended");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "started" }),
    });

    const { result } = renderHook(() => useWorkspaceResume("ws-1"), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.resume();
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/start", {
      method: "POST",
    });

    await waitFor(() => {
      expect(result.current.isResuming).toBe(false);
    });

    const healthState = queryClient.getQueryState(["agent-health", "ws-1"]);
    expect(healthState?.isInvalidated).toBe(true);

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Workspace resumed");
  });

  it("concurrent resume calls are deduplicated", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockImplementationOnce(() => pendingFetch);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspaceResume("ws-dedup"), {
      wrapper: Wrapper,
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

  it("health returns healthy after successful resume", async () => {
    const { queryClient, Wrapper } = createWrapper();

    // Given: health returns suspended
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "suspended" }),
    });

    const { result: healthResult } = renderHook(
      () => useAgentHealth("ws-flow", true),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(healthResult.current.data).toBe("suspended"));

    // When: resume is triggered
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "started" }),
    });

    const { result: resumeResult } = renderHook(
      () => useWorkspaceResume("ws-flow"),
      { wrapper: Wrapper },
    );

    // Then: next health poll returns healthy
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });

    act(() => {
      resumeResult.current.resume();
    });

    await waitFor(() => expect(resumeResult.current.isResuming).toBe(false));

    await queryClient.refetchQueries({
      queryKey: ["agent-health", "ws-flow"],
    });

    await waitFor(() => expect(healthResult.current.data).toBe("healthy"));
  });
});
