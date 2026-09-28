import { describe, expect, it } from "vitest";
import {
  createBinding,
  readJson,
  useReadFixture,
} from "@/tests/lib/omo/facade/read-fixture";

function summary(id: string, title: string, updatedMs: number) {
  return {
    durableId: id,
    sessionPath: `/sessions/${id}.jsonl`,
    forkedFrom: null,
    title,
    createdMs: 10,
    updatedMs,
  } as const;
}

function insertIndexRow(
  sqlite: import("better-sqlite3").Database,
  id: string,
  kind: "interactive" | "worker",
  parent: string | null = null,
): void {
  sqlite
    .prepare(
      `INSERT INTO omo_session_index
       (workspace_id, durable_id, session_path, parent_durable_id, kind, title,
        created_ms, updated_ms, updated_at)
       VALUES ('workspace-1', ?, ?, ?, ?, ?, 10, 20, 30)`,
    )
    .run(id, `/sessions/${id}.jsonl`, parent, kind, id);
}

describe("handleOmoRead session routes", () => {
  it("deduplicates disk and live roots and removes hidden worker ids", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.summaries.push(
      summary("disk", "Disk", 30),
      summary("shared", "Shared disk", 40),
      summary("worker", "Worker", 50),
    );
    insertIndexRow(fixture.sqlite, "shared", "interactive");
    insertIndexRow(fixture.sqlite, "live", "interactive");
    insertIndexRow(fixture.sqlite, "worker", "worker");
    fixture.client.isConnected = true;
    fixture.client.request.mockResolvedValue({
      data: {
        sessions: [
          {
            durableSessionId: "shared",
            cwd: "/workspace",
            kind: "interactive",
          },
          {
            durableSessionId: "live",
            cwd: "/workspace",
            kind: "interactive",
          },
          {
            durableSessionId: "worker",
            cwd: "/workspace",
            kind: "worker",
          },
        ],
      },
    });

    // When
    const response = await fixture.request("/session");

    // Then
    const body = await readJson(response);
    expect(
      Array.isArray(body) ? body.map((session) => session.id).sort() : body,
    ).toEqual(["omo_disk", "omo_live", "omo_shared"]);
    expect(fixture.registry.refreshIndexFromHost).toHaveBeenCalledOnce();
  });

  it("returns only indexed children even if an unrelated worker is live", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.authorized.add("parent");
    insertIndexRow(fixture.sqlite, "child", "worker", "parent");
    insertIndexRow(fixture.sqlite, "unrelated", "worker");
    fixture.client.isConnected = true;

    // When
    const response = await fixture.request("/session/omo_parent/children");

    // Then
    const body = await readJson(response);
    expect(
      Array.isArray(body) ? body.map((session) => session.id) : body,
    ).toEqual(["omo_child"]);
  });

  it("returns indexed children after the host is gone", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.authorized.add("parent");
    insertIndexRow(fixture.sqlite, "child", "worker", "parent");
    fixture.client.isConnected = false;

    // When
    const response = await fixture.request("/session/omo_parent/children");

    // Then
    expect(await readJson(response)).toMatchObject([{ id: "omo_child" }]);
    expect(fixture.registry.refreshIndexFromHost).not.toHaveBeenCalled();
  });

  it("serves detail, status, and empty todos in SDK-compatible shapes", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.authorized.add("root");
    fixture.source.summaries.push(summary("root", "Root", 20));
    fixture.registry.bindingsForLifecycle.mockReturnValue([
      createBinding("root", {}, true),
    ]);

    // When
    const detail = await fixture.request("/session/omo_root");
    const status = await fixture.request("/session/status");
    const todos = await fixture.request("/session/omo_root/todo");

    // Then
    expect(await readJson(detail)).toMatchObject({ id: "omo_root" });
    expect(await readJson(status)).toEqual({ omo_root: { type: "busy" } });
    expect(await readJson(todos)).toEqual([]);
  });

  it("excludes a live session reported under a foreign cwd from listing and the index", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.client.isConnected = true;
    fixture.client.request.mockResolvedValue({
      data: {
        sessions: [
          {
            durableSessionId: "foreign",
            cwd: "/other-workspace",
            kind: "interactive",
          },
        ],
      },
    });

    // When
    const response = await fixture.request("/session");
    const identities = await fixture.request("/session/identities");

    // Then
    const body = await readJson(response);
    expect(Array.isArray(body) ? body.map((s) => s.id) : body).toEqual([]);
    const identitiesBody = (await readJson(identities)) as {
      roots: string[];
      children: string[];
    };
    expect(identitiesBody.roots).not.toContain("omo_foreign");
    expect(identitiesBody.children).not.toContain("omo_foreign");
    const row = fixture.sqlite
      .prepare(
        "SELECT durable_id FROM omo_session_index WHERE durable_id = 'foreign'",
      )
      .get();
    expect(row).toBeUndefined();
  });

  it("returns not found for a session index row marked replaced", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.authorized.add("old");
    fixture.source.summaries.push(summary("old", "Old", 20));
    insertIndexRow(fixture.sqlite, "old", "interactive");
    fixture.sqlite
      .prepare(
        "UPDATE omo_session_index SET replaced_by_durable_id = 'new' WHERE durable_id = 'old'",
      )
      .run();

    // When
    const response = await fixture.request("/session/omo_old");

    // Then
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "session_not_found" });
  });

  it("sets parentID from the index row even when the session file is on disk", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.authorized.add("child");
    fixture.source.summaries.push(summary("child", "Child", 20));
    insertIndexRow(fixture.sqlite, "child", "worker", "parent-1");

    // When
    const response = await fixture.request("/session/omo_child");

    // Then
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      id: "omo_child",
      parentID: "omo_parent-1",
    });
  });

  it("serves a freshly created session from the index before the file exists", async () => {
    // Given
    const fixture = await useReadFixture();
    insertIndexRow(fixture.sqlite, "fresh", "interactive");

    // When
    const response = await fixture.request("/session/omo_fresh");

    // Then
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ id: "omo_fresh" });
    expect(fixture.source.authorizeSession).not.toHaveBeenCalled();
  });

  it("lists children and empty todos for a freshly created session before the file exists", async () => {
    // Given
    const fixture = await useReadFixture();
    insertIndexRow(fixture.sqlite, "fresh-parent", "interactive");

    // When
    const children = await fixture.request(
      "/session/omo_fresh-parent/children",
    );
    const todos = await fixture.request("/session/omo_fresh-parent/todo");

    // Then
    expect(children.status).toBe(200);
    expect(await readJson(children)).toEqual([]);
    expect(todos.status).toBe(200);
    expect(await readJson(todos)).toEqual([]);
    expect(fixture.source.authorizeSession).not.toHaveBeenCalled();
  });

  it("merges get_state into detail when the session is attached", async () => {
    // Given
    const fixture = await useReadFixture();
    const binding = createBinding("root");
    fixture.source.authorized.add("root");
    fixture.source.summaries.push(summary("root", "Disk title", 20));
    fixture.registry.findBinding.mockReturnValue(binding);
    fixture.registry.request.mockResolvedValue({
      data: { sessionName: "Attached title" },
    });

    // When
    const response = await fixture.request("/session/omo_root");

    // Then
    expect(await readJson(response)).toMatchObject({
      id: "omo_root",
      title: "Attached title",
    });
    expect(fixture.registry.request).toHaveBeenCalledWith(binding, {
      type: "get_state",
    });
  });

  it("returns live session stats for an attached session", async () => {
    // Given
    const fixture = await useReadFixture();
    const binding = createBinding("root");
    insertIndexRow(fixture.sqlite, "root", "interactive");
    fixture.registry.findBinding.mockReturnValue(binding);
    fixture.registry.request.mockResolvedValue({
      data: {
        tokens: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          total: 165,
        },
        cost: 0.42,
        contextUsage: {
          tokens: 120_000,
          contextWindow: 1_000_000,
          percent: 12,
        },
      },
    });

    // When
    const response = await fixture.request("/session/omo_root/stats");

    // Then
    expect(await readJson(response)).toEqual({
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 5,
        total: 165,
      },
      cost: 0.42,
      contextUsage: { tokens: 120_000, contextWindow: 1_000_000, percent: 12 },
    });
    expect(fixture.registry.request).toHaveBeenCalledWith(binding, {
      type: "get_session_stats",
    });
  });

  it("returns null stats without attaching a session that is not live", async () => {
    // Given
    const fixture = await useReadFixture();
    insertIndexRow(fixture.sqlite, "idle", "interactive");

    // When
    const response = await fixture.request("/session/omo_idle/stats");

    // Then
    expect(response.status).toBe(200);
    expect(await readJson(response)).toBeNull();
    expect(fixture.registry.request).not.toHaveBeenCalled();
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });

  it("returns 404 stats for an unknown session", async () => {
    // Given
    const fixture = await useReadFixture();

    // When
    const response = await fixture.request("/session/omo_nope/stats");

    // Then
    expect(response.status).toBe(404);
  });
});
