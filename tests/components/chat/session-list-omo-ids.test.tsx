import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as pinnedSessionsRoute from "@/app/api/workspaces/[id]/pinned-sessions/route";
import { isMessageVisible } from "@/components/chat/message";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import { QuestionBanner } from "@/components/chat/question-banner";
import { RunningSubAgentsBanner } from "@/components/chat/running-sub-agents-banner";
import { SessionList } from "@/components/chat/session-list";
import { useSessionManagement } from "@/components/chat/use-session-management";
import * as schema from "@/drizzle/schema";
import { entriesToMessages } from "@/lib/omo/adapter/entries-to-messages";
import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import type { SessionEntry } from "@/lib/omo/sessions-on-disk";
import type { QuestionRequest, Session } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  database: { current: undefined as unknown },
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  get db() {
    return mocks.database.current;
  },
}));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
  useHasCoarsePointer: () => false,
}));

const USER_ID = "user-omo";
const OMO_IN_USE_TOAST = "Session is open in another omo client";
const EMPTY_SESSIONS: Record<string, Session> = {};
const EMPTY_PINNED_SESSION_IDS: Set<string> = new Set();
const PROMPT_INPUT_REF: RefObject<PromptInputHandle | null> = {
  current: null,
};

type FetchHandler = (url: URL, init: RequestInit | undefined) => Response;

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new URL(String(input), "http://localhost"), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function omoSession(
  rawId: string,
  title: string,
  workspaceId: string,
  options: { readonly parentRawId?: string; readonly updated?: number } = {},
): Session {
  return buildOmoSession({
    rawId,
    workspaceId,
    directory: "/workspaces/omo",
    title,
    created: 1_000,
    updated: options.updated ?? 2_000,
    ...(options.parentRawId === undefined
      ? {}
      : { parentRawId: options.parentRawId }),
  });
}

function renderedSessionIds(): (string | null)[] {
  return Array.from(document.querySelectorAll("[data-session-id]")).map((row) =>
    row.getAttribute("data-session-id"),
  );
}

function seedWorkspace(
  workspaceId: string,
  sessions: readonly Session[],
  overrides: Partial<WorkspaceState> = {},
): void {
  const workspaceState: WorkspaceState = {
    sessions: Object.fromEntries(
      sessions.map((session) => [session.id, session]),
    ),
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
    ...overrides,
  };
  useChatStore.setState({
    activeWorkspaceId: workspaceId,
    activeSessionId: null,
    streamingError: null,
    workspaceStates: { [workspaceId]: workspaceState },
  });
}

function sessionRow(sessionId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-session-id="${sessionId}"]`,
  );
  if (!row) throw new Error(`No session row rendered for ${sessionId}`);
  return row;
}

function OmoSessionListHarness({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const sessions = useChatStore(
    (state) => state.workspaceStates[workspaceId]?.sessions ?? EMPTY_SESSIONS,
  );
  const pinnedSessionIds = useChatStore(
    (state) =>
      state.workspaceStates[workspaceId]?.pinnedSessionIds ??
      EMPTY_PINNED_SESSION_IDS,
  );
  const { handleDeleteSession, handlePinSession, handleUnpinSession } =
    useSessionManagement({
      activeWorkspaceId: workspaceId,
      allWorkspaces: [],
      healthStatus: "healthy",
      promptInputRef: PROMPT_INPUT_REF,
    });
  return (
    <SessionList
      mode="workspace"
      sessions={sessions}
      activeSessionId={null}
      sessionStatuses={{}}
      lastViewedAt={{}}
      pinnedSessionIds={pinnedSessionIds}
      onCreateSession={() => {}}
      onSelectSession={() => {}}
      onDeleteSession={handleDeleteSession}
      onPinSession={handlePinSession}
      onUnpinSession={handleUnpinSession}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("session list with omo session ids", () => {
  it("deletes omo_x through the opencode proxy with its workspace id", async () => {
    vi.useFakeTimers();
    const workspaceId = "ws-omo-delete";
    seedWorkspace(workspaceId, [omoSession("x", "Omo chat", workspaceId)]);
    const fetchMock = stubFetch((url, init) =>
      init?.method === "DELETE" &&
      url.pathname === "/api/opencode/session/omo_x"
        ? new Response(null, { status: 204 })
        : jsonResponse({ deleted: true }),
    );
    render(<OmoSessionListHarness workspaceId={workspaceId} />);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Delete" }),
    );
    expect(screen.queryByText("Omo chat")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/sessions/cache?workspaceId=${workspaceId}&sessionId=omo_x`,
          expect.objectContaining({ method: "DELETE" }),
        ),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opencode/session/omo_x?workspaceId=${workspaceId}`,
      { method: "DELETE" },
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().workspaceStates[workspaceId]?.sessions,
    ).not.toHaveProperty("omo_x");
  });

  it("restores omo_x with the omo toast when the facade answers 409 session_in_use", async () => {
    vi.useFakeTimers();
    const workspaceId = "ws-omo-in-use";
    seedWorkspace(workspaceId, [omoSession("x", "Omo chat", workspaceId)]);
    const fetchMock = stubFetch((url, init) =>
      init?.method === "DELETE" &&
      url.pathname === "/api/opencode/session/omo_x"
        ? jsonResponse({ error: "session_in_use" }, 409)
        : jsonResponse({}),
    );
    render(<OmoSessionListHarness workspaceId={workspaceId} />);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Delete" }),
    );
    expect(screen.queryByText("Omo chat")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith(OMO_IN_USE_TOAST),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opencode/session/omo_x?workspaceId=${workspaceId}`,
      { method: "DELETE" },
    );
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Omo chat")).toBeInTheDocument();
    expect(
      useChatStore.getState().workspaceStates[workspaceId]?.sessions,
    ).toHaveProperty("omo_x");
  });

  it("treats a facade 404 session_not_found as already deleted", async () => {
    vi.useFakeTimers();
    const workspaceId = "ws-omo-gone";
    seedWorkspace(workspaceId, [omoSession("x", "Omo chat", workspaceId)]);
    const fetchMock = stubFetch((url, init) =>
      init?.method === "DELETE" &&
      url.pathname === "/api/opencode/session/omo_x"
        ? jsonResponse({ error: "session_not_found" }, 404)
        : jsonResponse({ deleted: true }),
    );
    render(<OmoSessionListHarness workspaceId={workspaceId} />);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Delete" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/sessions/cache?workspaceId=${workspaceId}&sessionId=omo_x`,
          expect.objectContaining({ method: "DELETE" }),
        ),
      );
    });

    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText("Omo chat")).not.toBeInTheDocument();
  });

  it("keeps the generic failure toast for other facade conflicts", async () => {
    vi.useFakeTimers();
    const workspaceId = "ws-omo-unresolvable";
    seedWorkspace(workspaceId, [omoSession("x", "Omo chat", workspaceId)]);
    stubFetch((url, init) =>
      init?.method === "DELETE" &&
      url.pathname === "/api/opencode/session/omo_x"
        ? jsonResponse({ error: "session_not_resolvable" }, 409)
        : jsonResponse({}),
    );
    render(<OmoSessionListHarness workspaceId={workspaceId} />);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Delete" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith("Failed to delete chat"),
      );
    });

    expect(mocks.toast.error).not.toHaveBeenCalledWith(OMO_IN_USE_TOAST);
    expect(screen.getByText("Omo chat")).toBeInTheDocument();
  });

  it("clears an omo question the facade no longer knows (404 question_not_found)", async () => {
    const workspaceId = "ws-omo-question";
    const question: QuestionRequest = {
      id: "dh_q_stale",
      sessionID: "omo_x",
      questions: [
        {
          question: "Which branch?",
          header: "Branch",
          options: [{ label: "main", description: "Default branch" }],
        },
      ],
    };
    seedWorkspace(workspaceId, [omoSession("x", "Omo chat", workspaceId)], {
      questions: [question],
    });
    useChatStore.setState({ activeSessionId: "omo_x" });
    const fetchMock = stubFetch((url) =>
      url.pathname === "/api/opencode/question/dh_q_stale/reject"
        ? jsonResponse({ error: "question_not_found" }, 404)
        : jsonResponse({}),
    );
    expect(useChatStore.getState().getActiveQuestionSessionIds()).toEqual(
      new Set(["omo_x"]),
    );
    render(
      <QuestionBanner
        request={question}
        onReply={(answers) =>
          void useChatStore
            .getState()
            .replyToQuestion(question.id, answers, workspaceId)
        }
        onReject={() =>
          void useChatStore.getState().rejectQuestion(question.id, workspaceId)
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          useChatStore.getState().workspaceStates[workspaceId]?.questions,
        ).toEqual([]),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opencode/question/dh_q_stale/reject?workspaceId=${workspaceId}`,
      { method: "POST" },
    );
    expect(useChatStore.getState().getActiveQuestionSessionIds().size).toBe(0);
  });
});

describe("pinning omo sessions through pinned_sessions", () => {
  const workspaceId = "ws-omo-pin";
  let sqlite: Database.Database;

  function pinnedSessionIdsInDatabase(): string[] {
    const rows = sqlite
      .prepare(
        "SELECT session_id AS sessionId FROM pinned_sessions WHERE workspace_id = ? ORDER BY session_id",
      )
      .all(workspaceId) as { sessionId: string }[];
    return rows.map((row) => row.sessionId);
  }

  async function callPinnedSessionsRoute(
    url: URL,
    init: RequestInit | undefined,
  ): Promise<Response> {
    const match = /^\/api\/workspaces\/([^/]+)\/pinned-sessions$/.exec(
      url.pathname,
    );
    if (!match?.[1]) throw new Error(`Unexpected pin route ${url.pathname}`);
    const request = new NextRequest(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const context = {
      params: Promise.resolve({ id: decodeURIComponent(match[1]) }),
    };
    if (init?.method === "POST")
      return pinnedSessionsRoute.POST(request, context);
    if (init?.method === "DELETE") {
      return pinnedSessionsRoute.DELETE(request, context);
    }
    return pinnedSessionsRoute.GET(request, context);
  }

  beforeEach(() => {
    sqlite = new Database(":memory:");
    const database = drizzle(sqlite, { schema });
    migrate(database, { migrationsFolder: "drizzle/migrations" });
    mocks.database.current = database;
    sqlite
      .prepare(
        "INSERT INTO users (id, username, password_hash) VALUES (?, 'omo-user', 'hash')",
      )
      .run(USER_ID);
    sqlite
      .prepare(
        "INSERT INTO workspaces (id, user_id, name, path, type, engine) VALUES (?, ?, 'Omo', '/workspaces/omo', 'repo', 'omo')",
      )
      .run(workspaceId, USER_ID);
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/pinned-sessions")) {
          return callPinnedSessionsRoute(url, init);
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    sqlite.close();
    mocks.database.current = undefined;
  });

  it("persists omo_x, hydrates it back, and unpins it", async () => {
    seedWorkspace(workspaceId, [
      omoSession("x", "Omo chat", workspaceId),
      omoSession("y", "Newer omo chat", workspaceId, { updated: 3_000 }),
    ]);
    render(<OmoSessionListHarness workspaceId={workspaceId} />);
    expect(renderedSessionIds()).toEqual(["omo_y", "omo_x"]);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Pin" }),
    );
    await vi.waitFor(() =>
      expect(pinnedSessionIdsInDatabase()).toEqual(["omo_x"]),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/pinned-sessions`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "omo_x" }),
      }),
    );

    act(() => {
      useChatStore.setState((state) => {
        const workspaceState = state.workspaceStates[workspaceId];
        if (!workspaceState) return state;
        return {
          workspaceStates: {
            ...state.workspaceStates,
            [workspaceId]: { ...workspaceState, pinnedSessionIds: new Set() },
          },
        };
      });
    });
    expect(renderedSessionIds()).toEqual(["omo_y", "omo_x"]);
    await act(async () => {
      await useChatStore.getState().fetchPinnedSessions(workspaceId);
    });
    expect(
      useChatStore.getState().workspaceStates[workspaceId]?.pinnedSessionIds,
    ).toEqual(new Set(["omo_x"]));
    expect(renderedSessionIds()).toEqual(["omo_x", "omo_y"]);

    fireEvent.click(
      within(sessionRow("omo_x")).getByRole("button", { name: "Unpin" }),
    );
    await vi.waitFor(() => expect(pinnedSessionIdsInDatabase()).toEqual([]));
    expect(fetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/pinned-sessions?sessionId=omo_x`,
      { method: "DELETE" },
    );
  });
});

describe("sub-agent dialog with omo children", () => {
  it("renders a child returned by the facade children route and aborts it by its omo id", async () => {
    const workspaceId = "ws-omo-children";
    const child = omoSession("child", "explore", workspaceId, {
      parentRawId: "parent",
    });
    seedWorkspace(workspaceId, [
      omoSession("parent", "Parent chat", workspaceId),
    ]);
    useChatStore.setState({ activeSessionId: "omo_parent" });
    const fetchMock = stubFetch((url) => {
      switch (url.pathname) {
        case "/api/opencode/session/omo_parent/children":
          return jsonResponse([child]);
        case "/api/opencode/session/status":
          return jsonResponse({ omo_child: { type: "busy" } });
        case "/api/opencode/session/omo_child/abort":
          return new Response(null, { status: 204 });
        case "/api/sessions/messages":
          return jsonResponse({
            messages: [],
            hasMore: false,
            total: 0,
            source: "remote",
          });
        default:
          return jsonResponse([]);
      }
    });
    const user = userEvent.setup();
    render(
      <RunningSubAgentsBanner
        parentSessionId="omo_parent"
        workspaceId={workspaceId}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /explore/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("explore")).toBeInTheDocument();
    expect(child.parentID).toBe("omo_parent");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opencode/session/omo_parent/children?workspaceId=${workspaceId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Abort" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/opencode/session/omo_child/abort?workspaceId=${workspaceId}`,
      { method: "POST" },
    );
    await waitFor(() =>
      expect(
        useChatStore.getState().workspaceStates[workspaceId]?.sessionStatuses[
          "omo_child"
        ],
      ).toEqual({ type: "idle" }),
    );
    expect(within(dialog).getByText("Idle")).toBeInTheDocument();
  });
});

describe("omo internal initiator reminders", () => {
  function userEntry(id: string, text: string): SessionEntry {
    return {
      type: "message",
      id,
      parentId: null,
      timestamp: 1_000,
      message: { role: "user", content: text },
    };
  }

  it("hides omo user messages that carry the OMO_INTERNAL_INITIATOR marker", () => {
    const messages = entriesToMessages(
      [
        userEntry("u1", "Continue the plan\n<!-- OMO_INTERNAL_INITIATOR -->"),
        userEntry("u2", "Ship it"),
      ],
      {
        sessionId: "omo_x",
        workspacePath: "/workspaces/omo",
        skillPrefixes: [],
      },
    );

    expect(messages.map((message) => message.info.id)).toEqual([
      "omo_u1",
      "omo_u2",
    ]);
    expect(
      messages.map((message) =>
        isMessageVisible(message, { showThinking: true, showToolCalls: true }),
      ),
    ).toEqual([false, true]);
  });
});
