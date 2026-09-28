import { describe, expect, it, vi } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { SessionEntry } from "@/lib/omo/sessions-on-disk";
import {
  createBinding,
  readJson,
  useReadFixture,
} from "@/tests/lib/omo/facade/read-fixture";

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
  timestamp: number,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role,
      content: role === "user" ? text : [{ type: "text", text }],
      timestamp,
    },
  };
}

function messageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "info" in message &&
      typeof message.info === "object" &&
      message.info !== null &&
      "id" in message.info &&
      typeof message.info.id === "string"
    ) {
      return [message.info.id];
    }
    return [];
  });
}

function namedError(
  name: string,
  fields: Readonly<Record<string, unknown>> = {},
): Error {
  return Object.assign(new Error(name), { name, ...fields });
}

function insertLeaf(
  sqlite: import("better-sqlite3").Database,
  durableId: string,
  leafEntryId: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO omo_session_index
       (workspace_id, durable_id, session_path, kind, title, created_ms,
        updated_ms, leaf_known, leaf_entry_id, updated_at)
       VALUES ('workspace-1', ?, ?, 'interactive', ?, 1, 1, 1, ?, 1)`,
    )
    .run(
      durableId,
      `/sessions/${durableId}.jsonl`,
      durableId,
      leafEntryId,
    );
}

describe("handleOmoRead message history", () => {
  it("attaches before get_entries and returns the active branch window", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("branch");
    const entries = [
      messageEntry("root", null, "user", "root", 1),
      messageEntry("abandoned", "root", "assistant", "abandoned", 2),
      messageEntry("main", "root", "assistant", "main", 3),
      messageEntry("leaf", "main", "user", "leaf", 4),
    ];
    fixture.registry.attach.mockResolvedValue(createBinding("branch"));
    fixture.registry.request.mockResolvedValue({
      data: { entries, leafId: "leaf" },
    });

    const tail = await fixture.request("/session/omo_branch/message", {
      limit: "2",
    });
    const before = await fixture.request("/session/omo_branch/message", {
      limit: "1",
      before: "omo_main",
    });

    expect(messageIds(await readJson(tail))).toEqual(["omo_main", "omo_leaf"]);
    expect(messageIds(await readJson(before))).toEqual(["omo_root"]);
    expect(fixture.registry.attach).toHaveBeenCalledWith({
      workspace: fixture.workspace,
      durableId: "branch",
    });
    expect(fixture.registry.attach.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.registry.request.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("replays pending questions into the workspace dialog ledger", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("question-session");
    const pendingQuestion: JsonlRecord = {
      type: "extension_ui_request",
      id: "question-1",
      method: "question",
      requestId: "request-1",
      waitForAnswer: true,
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Pick one",
          options: [{ label: "A", description: "Option A" }],
          multiSelect: false,
        },
      ],
    };
    fixture.registry.attach.mockResolvedValue(
      createBinding("question-session", {
        pendingQuestions: [pendingQuestion],
      }),
    );

    const history = await fixture.request(
      "/session/omo_question-session/message",
    );
    vi.resetModules();
    const { handleOmoRead } = await import("@/lib/omo/facade/read");
    const questions = await handleOmoRead({
      method: "GET",
      path: "/question",
      query: new URLSearchParams(),
      workspace: fixture.workspace,
      userId: "user-1",
    });

    expect(history.status).toBe(200);
    expect(await readJson(questions)).toMatchObject([
      {
        sessionID: "omo_question-session",
        questions: [{ header: "Choice", question: "Pick one" }],
      },
    ]);
  });

  it("authorizes before attach and strips the public prefix once", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("exact-id");

    await fixture.request("/session/omo_exact-id/message");

    expect(fixture.source.authorizeSession).toHaveBeenCalledWith("exact-id");
    expect(fixture.registry.attach).toHaveBeenCalledWith(
      expect.objectContaining({ durableId: "exact-id" }),
    );
    expect(
      fixture.source.authorizeSession.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.registry.attach.mock.invocationCallOrder[0] ?? Infinity);
  });

  it.each(["OmoTransportGoneError", "OmoCorruptIndexRowError"])(
    "uses the indexed leaf for disk fallback after %s",
    async (errorName) => {
      const fixture = await useReadFixture();
      const entries = [
        messageEntry("root", null, "user", "root", 1),
        messageEntry("main", "root", "assistant", "main", 2),
        messageEntry("abandoned", "root", "assistant", "abandoned", 3),
      ];
      fixture.source.authorized.add("fallback");
      fixture.source.entries.set("fallback", entries);
      insertLeaf(fixture.sqlite, "fallback", "main");
      fixture.registry.attach.mockRejectedValue(namedError(errorName));

      const response = await fixture.request(
        "/session/omo_fallback/message",
      );

      expect(response.status).toBe(200);
      expect(messageIds(await readJson(response))).toEqual([
        "omo_root",
        "omo_main",
      ]);
    },
  );

  it("falls back after attach when get_entries loses the host", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("drop");
    fixture.source.entries.set("drop", [
      messageEntry("disk-leaf", null, "user", "disk", 1),
    ]);
    fixture.registry.request.mockRejectedValue(
      namedError("OmoEngineUnavailableError", { statusCode: 503 }),
    );

    const response = await fixture.request("/session/omo_drop/message");

    expect(response.status).toBe(200);
    expect(messageIds(await readJson(response))).toEqual(["omo_disk-leaf"]);
    expect(fixture.registry.attach).toHaveBeenCalledOnce();
  });

  it("returns the successor without reading replacement history", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("old");
    fixture.registry.attach.mockRejectedValue(
      namedError("OmoSessionReplacedError", { newDurableId: "next" }),
    );

    const response = await fixture.request("/session/omo_old/message");

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Omo-Session-Replaced")).toBe("omo_next");
    expect(await readJson(response)).toEqual({ error: "session_replaced" });
    expect(fixture.source.readEntries).not.toHaveBeenCalled();
  });
});
