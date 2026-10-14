import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command, Session } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";

vi.mock("sonner", () => ({ toast: vi.fn() }));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve = (_response: Response) => {};
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function session(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: "",
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function command(name: string): Command {
  return { name, template: "", hints: [] };
}

function stubSessionCreation(created: Session) {
  const fetchMock = vi.fn(async (url: string) =>
    url.startsWith("/api/opencode/session")
      ? jsonResponse(created)
      : jsonResponse({}),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const initialStoreState = useChatStore.getState();

afterEach(() => {
  useChatStore.setState(initialStoreState, true);
  vi.unstubAllGlobals();
});

describe("chat store engine choice", () => {
  it("creates a session on the engine picked for it", async () => {
    const fetchMock = stubSessionCreation(session("omo_new"));

    const created = await useChatStore.getState().createSession("ws-a", "omo");

    expect(created?.id).toBe("omo_new");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/opencode/session?workspaceId=ws-a&engine=omo",
    );
    expect(useChatStore.getState().activeSessionId).toBe("omo_new");
  });

  it("leaves the engine to the server when none is picked", async () => {
    const fetchMock = stubSessionCreation(session("ses_new"));

    await useChatStore.getState().createSession("ws-a");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/opencode/session?workspaceId=ws-a",
    );
  });

  it("loads commands from the requested engine and drops an older request's late reply", async () => {
    const openCodeReply = deferredResponse();
    const omoReply = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(openCodeReply.promise)
      .mockReturnValueOnce(omoReply.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { fetchCommands } = useChatStore.getState();

    const openCodeLoad = fetchCommands("ws-a", "opencode");
    const omoLoad = fetchCommands("ws-a", "omo");
    omoReply.resolve(jsonResponse([command("ulw-plan")]));
    await omoLoad;
    openCodeReply.resolve(jsonResponse([command("review")]));
    await openCodeLoad;

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/opencode/command?workspaceId=ws-a&engine=opencode",
      "/api/opencode/command?workspaceId=ws-a&engine=omo",
    ]);
    expect(useChatStore.getState().commands.map((item) => item.name)).toEqual([
      "ulw-plan",
    ]);
  });
});
