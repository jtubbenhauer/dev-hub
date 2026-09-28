import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveEffectiveEngine,
  useWorkspaceEngine,
  workspaceEngineQueryKey,
} from "@/hooks/use-workspace-engine";

interface EngineFetchState {
  workspaceResponse: Response | (() => Response);
  globalEngine?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubEngineFetch(state: EngineFetchState) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/settings") {
      return jsonResponse(
        state.globalEngine === undefined
          ? {}
          : { "chat-engine": state.globalEngine },
      );
    }
    if (url.startsWith("/api/workspaces/")) {
      return typeof state.workspaceResponse === "function"
        ? state.workspaceResponse()
        : state.workspaceResponse;
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("resolveEffectiveEngine", () => {
  it.each([
    { workspace: null, global: undefined, expected: "opencode" },
    { workspace: undefined, global: "omo", expected: "omo" },
    { workspace: null, global: "omo", expected: "omo" },
    { workspace: "omo", global: "opencode", expected: "omo" },
    { workspace: "opencode", global: "omo", expected: "opencode" },
    { workspace: "bogus", global: "omo", expected: "opencode" },
    { workspace: null, global: "bogus", expected: "opencode" },
  ])(
    "workspace $workspace + global $global resolves to $expected",
    ({ workspace, global, expected }) => {
      expect(resolveEffectiveEngine(workspace, global)).toBe(expected);
    },
  );
});

describe("useWorkspaceEngine", () => {
  it("resolves the workspace override fetched from GET /api/workspaces/:id", async () => {
    const fetchMock = stubEngineFetch({
      workspaceResponse: jsonResponse({ id: "ws-1", engine: "omo" }),
      globalEngine: "opencode",
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceEngine("ws-1"), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current).toEqual({ engine: "omo", isLoading: false });
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1");
  });

  it("inherits the global chat-engine setting when the workspace engine is null", async () => {
    stubEngineFetch({
      workspaceResponse: jsonResponse({ id: "ws-1", engine: null }),
      globalEngine: "omo",
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceEngine("ws-1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ engine: "omo", isLoading: false });
    });
  });

  it("uses only the global setting without fetching when there is no workspace", async () => {
    const fetchMock = stubEngineFetch({
      workspaceResponse: jsonResponse({}),
      globalEngine: "omo",
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceEngine(null), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ engine: "omo", isLoading: false });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/settings");
  });

  it("falls back to the global setting when the workspace cannot be loaded", async () => {
    stubEngineFetch({
      workspaceResponse: jsonResponse({ error: "Not found" }, 404),
      globalEngine: "omo",
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceEngine("ws-missing"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ engine: "omo", isLoading: false });
    });
  });

  it("refetches the engine when workspace queries are invalidated", async () => {
    let workspaceEngine = "omo";
    stubEngineFetch({
      workspaceResponse: () =>
        jsonResponse({ id: "ws-1", engine: workspaceEngine }),
    });
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceEngine("ws-1"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.engine).toBe("omo");
    });

    workspaceEngine = "opencode";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    });

    await waitFor(() => {
      expect(result.current.engine).toBe("opencode");
    });
    expect(workspaceEngineQueryKey("ws-1")[0]).toBe("workspaces");
  });
});
