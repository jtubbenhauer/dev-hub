// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

const { mockAuth, mockResolveConfig, mockRequestCompletion, mockIsEnabled } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockResolveConfig: vi.fn(),
    mockRequestCompletion: vi.fn(),
    mockIsEnabled: vi.fn(),
  }));

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/chat-suggest/llm", () => ({
  resolveChatSuggestConfig: mockResolveConfig,
  requestChatCompletion: mockRequestCompletion,
}));
vi.mock("@/lib/chat-suggest/settings", () => ({
  isChatSuggestionsEnabledForUser: mockIsEnabled,
}));

let sqlite: Database.Database;
let POST: (typeof import("@/app/api/workspaces/[id]/session-title/route"))["POST"];

function titleRequest(body: Record<string, unknown>, workspaceId = "ws-1") {
  return POST(
    new NextRequest(
      `http://localhost/api/workspaces/${workspaceId}/session-title`,
      {
        method: "POST",
        body: JSON.stringify({
          sessionId: "s1",
          currentTitle: "Untitled",
          userMessages: ["Fix the login redirect"],
          agentMessages: ["Fixed."],
          ...body,
        }),
      },
    ),
    { params: Promise.resolve({ id: workspaceId }) },
  );
}

beforeEach(async () => {
  vi.resetModules();
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE session_title_states (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      last_auto_title_turn INTEGER NOT NULL DEFAULT 0,
      last_generated_title TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    );
    INSERT INTO workspaces VALUES ('ws-1', 'user-1'), ('ws-other', 'user-2');
  `);
  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  ({ POST } = await import("@/app/api/workspaces/[id]/session-title/route"));
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockIsEnabled.mockResolvedValue(true);
  mockResolveConfig.mockResolvedValue({
    baseUrl: "https://example.test/v1",
    apiKey: "key",
    model: "test-model",
  });
  mockRequestCompletion.mockResolvedValue('"Login redirect fix."');
});

afterEach(() => {
  sqlite.close();
  vi.doUnmock("@/lib/db");
  vi.clearAllMocks();
});

describe("POST /api/workspaces/[id]/session-title", () => {
  it("hides workspaces the user does not own", async () => {
    const response = await titleRequest({ trigger: "regenerate" }, "ws-other");
    expect(response.status).toBe(404);
  });

  it("rejects a body without a trigger", async () => {
    expect((await titleRequest({})).status).toBe(400);
  });

  it("titles turn 1 once, even when asked twice", async () => {
    const first = await titleRequest({ trigger: "auto", turn: 1 });
    const second = await titleRequest({ trigger: "auto", turn: 1 });

    expect(await first.json()).toEqual({ title: "Login redirect fix" });
    expect(await second.json()).toEqual({ skipped: "already_titled" });
    expect(mockRequestCompletion).toHaveBeenCalledTimes(1);
  });

  it("skips turns other than 1 and 3", async () => {
    const response = await titleRequest({ trigger: "auto", turn: 2 });
    expect(await response.json()).toEqual({ skipped: "not_a_title_turn" });
    expect(mockRequestCompletion).not.toHaveBeenCalled();
  });

  it("retitles at turn 3 while the title is still the generated one", async () => {
    await titleRequest({ trigger: "auto", turn: 1 });
    mockRequestCompletion.mockResolvedValue("Deposit refunds");

    const response = await titleRequest({
      trigger: "auto",
      turn: 3,
      currentTitle: "Login redirect fix",
    });

    expect(await response.json()).toEqual({ title: "Deposit refunds" });
  });

  it("stops auto titling after the user renames the chat", async () => {
    await titleRequest({ trigger: "auto", turn: 1 });

    const response = await titleRequest({
      trigger: "auto",
      turn: 3,
      currentTitle: "My own name",
    });

    expect(await response.json()).toEqual({ skipped: "renamed_by_user" });
    expect(mockRequestCompletion).toHaveBeenCalledTimes(1);
  });

  it("regenerates on request even after a manual rename", async () => {
    await titleRequest({ trigger: "auto", turn: 1 });
    mockRequestCompletion.mockResolvedValue("Fresh title");

    const response = await titleRequest({
      trigger: "regenerate",
      currentTitle: "My own name",
    });

    expect(await response.json()).toEqual({ title: "Fresh title" });
  });

  it("never sends conversation text when suggestions are disabled", async () => {
    mockIsEnabled.mockResolvedValue(false);

    const placeholder = await titleRequest({ trigger: "auto", turn: 1 });
    const named = await titleRequest({
      trigger: "auto",
      turn: 3,
      currentTitle: "Fix the login redirect",
    });
    const regenerate = await titleRequest({ trigger: "regenerate" });

    expect(await placeholder.json()).toEqual({
      title: "Fix the login redirect",
    });
    expect(await named.json()).toEqual({ skipped: "no_title" });
    expect(regenerate.status).toBe(503);
    expect(mockRequestCompletion).not.toHaveBeenCalled();
  });

  it("tells the model how long the session is", async () => {
    await titleRequest({
      trigger: "regenerate",
      userTurnCount: 109,
      sessionSpanMs: 156 * 60 * 60 * 1000,
    });

    const [, prompt] = mockRequestCompletion.mock.calls[0] as [
      unknown,
      { content: string }[],
    ];
    expect(prompt[1]?.content).toContain(
      '<session length="109 developer messages over 6.5 days" />',
    );
  });

  it("reports a failed model call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRequestCompletion.mockRejectedValue(new Error("boom"));
    const response = await titleRequest({ trigger: "regenerate" });
    expect(response.status).toBe(502);
  });
});
