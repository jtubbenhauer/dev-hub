import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  useTerminalConfig,
  type TerminalConfig,
} from "@/hooks/use-terminal-config";

const LOCAL_CONFIG: TerminalConfig = {
  wsUrl: "ws://127.0.0.1:7623",
  cwd: "/repo",
  shellCommand: null,
};

interface DeferredResponse {
  readonly promise: Promise<Response>;
  readonly resolve: (response: Response) => void;
}

function createDeferredResponse(): DeferredResponse {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn<(url: string) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTerminalConfig", () => {
  it("resolves the workspace's terminal config", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json(LOCAL_CONFIG));

    // When
    const { result } = renderHook(() => useTerminalConfig("ws 1"));

    // Then
    await waitFor(() =>
      expect(result.current).toEqual({
        config: LOCAL_CONFIG,
        error: null,
        isLoading: false,
      }),
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/terminal/resolve?workspaceId=ws%201",
    );
  });

  it("is loading until the config arrives", () => {
    // Given
    fetchMock.mockReturnValue(createDeferredResponse().promise);

    // When
    const { result } = renderHook(() => useTerminalConfig("ws-1"));

    // Then
    expect(result.current).toEqual({
      config: null,
      error: null,
      isLoading: true,
    });
  });

  it("reports the server's error message when resolving fails", async () => {
    // Given
    fetchMock.mockResolvedValue(
      Response.json({ error: "Workspace not found" }, { status: 500 }),
    );

    // When
    const { result } = renderHook(() => useTerminalConfig("ws-1"));

    // Then
    await waitFor(() =>
      expect(result.current).toEqual({
        config: null,
        error: "Workspace not found",
        isLoading: false,
      }),
    );
  });

  it("falls back to the status code when the error body has no message", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json({}, { status: 500 }));

    // When
    const { result } = renderHook(() => useTerminalConfig("ws-1"));

    // Then
    await waitFor(() =>
      expect(result.current.error).toBe("Failed to resolve terminal (500)"),
    );
  });

  it("drops a late answer for the previous workspace", async () => {
    // Given
    const firstWorkspaceResponse = createDeferredResponse();
    fetchMock
      .mockReturnValueOnce(firstWorkspaceResponse.promise)
      .mockReturnValueOnce(createDeferredResponse().promise);
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useTerminalConfig(workspaceId),
      { initialProps: { workspaceId: "ws-1" } },
    );
    rerender({ workspaceId: "ws-2" });

    // When
    await act(async () => {
      firstWorkspaceResponse.resolve(Response.json(LOCAL_CONFIG));
      await firstWorkspaceResponse.promise;
    });

    // Then
    expect(result.current).toEqual({
      config: null,
      error: null,
      isLoading: true,
    });
  });
});
