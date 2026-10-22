import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageWithParts } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    loading: vi.fn(() => "toast-1"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

const initialStoreState = useChatStore.getState();

function makeSession(id: string, options: { parentID?: string } = {}) {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: "Untitled",
    version: "1",
    parentID: options.parentID,
    time: { created: 1000, updated: 1000 },
  };
}

function userMessage(index: number): MessageWithParts {
  return {
    info: { id: `u${index}`, role: "user", sessionID: "s1" },
    parts: [{ type: "text", text: `ask ${index}` }],
  } as unknown as MessageWithParts;
}

function seedSession(
  userTurns: number,
  options: { parentID?: string; hasMoreBefore?: boolean } = {},
) {
  useChatStore.setState({
    hasMoreBeforeBySession: options.hasMoreBefore ? { "ws-1:s1": true } : {},
    workspaceStates: {
      "ws-1": {
        sessions: { s1: makeSession("s1", options) },
        sessionsLoaded: true,
        messages: {
          s1: Array.from({ length: userTurns }, (_, index) =>
            userMessage(index + 1),
          ),
        },
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {},
        sessionAgents: {},
        sessionModels: {},
        sessionVariants: {},
        lastViewedAt: {},
        pinnedSessionIds: new Set(),
        sessionNotes: {},
      },
    },
  });
}

function stubTitleFetch(titleResponse: Response) {
  const fetchSpy = vi.fn(async (url: string) =>
    url.includes("/session-title")
      ? titleResponse
      : Response.json({ ...makeSession("s1"), title: "Login fix" }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function titleRequestBody(fetchSpy: ReturnType<typeof stubTitleFetch>) {
  const call = fetchSpy.mock.calls.find(([url]) =>
    String(url).includes("/session-title"),
  ) as unknown as [string, RequestInit] | undefined;
  return call ? JSON.parse(String(call[1].body)) : undefined;
}

beforeEach(() => {
  useChatStore.setState(initialStoreState, true);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("autoTitleSessionAfterTurn", () => {
  it.each([1, 3])(
    "asks for a title after turn %i and saves it",
    async (turn) => {
      seedSession(turn);
      const fetchSpy = stubTitleFetch(Response.json({ title: "Login fix" }));

      await useChatStore.getState().autoTitleSessionAfterTurn("s1", "ws-1");

      expect(titleRequestBody(fetchSpy)).toMatchObject({
        sessionId: "s1",
        trigger: "auto",
        turn,
        userTurnCount: turn,
      });
      expect(
        useChatStore.getState().workspaceStates["ws-1"]?.sessions.s1?.title,
      ).toBe("Login fix");
    },
  );

  it.each([
    ["turn 2", 2, {}],
    ["a sub-agent session", 1, { parentID: "parent" }],
    ["a partly loaded history", 3, { hasMoreBefore: true }],
  ])("does nothing for %s", async (_label, turns, options) => {
    seedSession(turns, options);
    const fetchSpy = stubTitleFetch(Response.json({ title: "x" }));

    await useChatStore.getState().autoTitleSessionAfterTurn("s1", "ws-1");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves the title alone when the server skips the turn", async () => {
    seedSession(1);
    const fetchSpy = stubTitleFetch(
      Response.json({ skipped: "already_titled" }),
    );

    await useChatStore.getState().autoTitleSessionAfterTurn("s1", "ws-1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("regenerateSessionTitle", () => {
  it("renames the session with the regenerated title", async () => {
    seedSession(2);
    const fetchSpy = stubTitleFetch(Response.json({ title: "Login fix" }));

    const isRenamed = await useChatStore
      .getState()
      .regenerateSessionTitle("s1", "ws-1");

    expect(isRenamed).toBe(true);
    expect(titleRequestBody(fetchSpy)).toMatchObject({ trigger: "regenerate" });
    expect(toastMock.success).toHaveBeenCalledWith("Title updated", {
      id: "toast-1",
      description: "Login fix",
    });
  });

  it("reads older history first when only the latest messages are loaded", async () => {
    seedSession(2, { hasMoreBefore: true });
    const olderRequest = {
      info: { id: "u0", role: "user", sessionID: "s1" },
      parts: [
        { type: "text", text: "Prepare the Stripe Connect production release" },
      ],
    };
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/sessions/messages?")) {
        return Response.json({ messages: [olderRequest], hasMore: false });
      }
      return url.includes("/session-title")
        ? Response.json({ title: "Stripe Connect release" })
        : Response.json({
            ...makeSession("s1"),
            title: "Stripe Connect release",
          });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await useChatStore.getState().regenerateSessionTitle("s1", "ws-1");

    const historyUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(new URL(historyUrl, "http://x").searchParams.get("before")).toBe(
      "u1",
    );
    expect(titleRequestBody(fetchSpy)?.userMessages[0]).toBe(
      "Prepare the Stripe Connect production release",
    );
    expect(
      useChatStore.getState().workspaceStates["ws-1"]?.messages.s1,
    ).toHaveLength(2);
  });

  it("shows the server's reason when it cannot generate a title", async () => {
    seedSession(2);
    stubTitleFetch(
      Response.json({ error: "Title generation needs a key" }, { status: 503 }),
    );

    const isRenamed = await useChatStore
      .getState()
      .regenerateSessionTitle("s1", "ws-1");

    expect(isRenamed).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(
      "Couldn't regenerate the title",
      { id: "toast-1", description: "Title generation needs a key" },
    );
  });
});
