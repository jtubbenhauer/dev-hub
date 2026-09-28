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
});
