import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "@/components/chat/agent-selector";
import type { ChatEngine } from "@/lib/engine/types";
import type { Agent } from "@/lib/opencode/types";

function deferredResponse() {
  let resolve = (_response: Response) => {};
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeAgent(name: string): Agent {
  return {
    name,
    description: name,
    mode: "primary",
    native: false,
    hidden: false,
    topP: 1,
    temperature: 1,
    color: "#000000",
    permission: [],
    options: {},
  };
}

describe("useAgents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores an agent response from the previous workspace", async () => {
    const workspaceAResponse = deferredResponse();
    const workspaceBResponse = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(workspaceAResponse.promise)
        .mockReturnValueOnce(workspaceBResponse.promise),
    );

    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) => useAgents(workspaceId),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    rerender({ workspaceId: "workspace-b" });

    await act(async () => {
      workspaceBResponse.resolve(
        new Response(JSON.stringify({ Hephaestus: makeAgent("Hephaestus") }), {
          status: 200,
        }),
      );
      await workspaceBResponse.promise;
    });
    await waitFor(() => {
      expect(result.current.primaryAgents.map((agent) => agent.name)).toEqual([
        "Hephaestus",
      ]);
    });

    await act(async () => {
      workspaceAResponse.resolve(
        new Response(JSON.stringify({ Prometheus: makeAgent("Prometheus") }), {
          status: 200,
        }),
      );
      await workspaceAResponse.promise;
    });

    expect(result.current.primaryAgents.map((agent) => agent.name)).toEqual([
      "Hephaestus",
    ]);
  });

  it("asks for the requested engine's agents and refetches when the engine changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ build: makeAgent("build") }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ "skill:ulw-plan": makeAgent("skill:ulw-plan") }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ engine }: { engine: ChatEngine }) => useAgents("workspace-a", engine),
      { initialProps: { engine: "opencode" as ChatEngine } },
    );
    await waitFor(() => {
      expect(result.current.primaryAgents.map((agent) => agent.name)).toEqual([
        "build",
      ]);
    });

    rerender({ engine: "omo" });
    expect(result.current.primaryAgents).toEqual([]);

    await waitFor(() => {
      expect(result.current.primaryAgents.map((agent) => agent.name)).toEqual([
        "skill:ulw-plan",
      ]);
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/opencode/agent?workspaceId=workspace-a&engine=opencode",
      "/api/opencode/agent?workspaceId=workspace-a&engine=omo",
    ]);
  });

  it("does not expose loaded agents while the next workspace is loading", async () => {
    const workspaceBResponse = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ Prometheus: makeAgent("Prometheus") }),
            { status: 200 },
          ),
        )
        .mockReturnValueOnce(workspaceBResponse.promise),
    );

    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) => useAgents(workspaceId),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => {
      expect(result.current.primaryAgents.map((agent) => agent.name)).toEqual([
        "Prometheus",
      ]);
    });

    rerender({ workspaceId: "workspace-b" });

    expect(result.current.primaryAgents).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});
