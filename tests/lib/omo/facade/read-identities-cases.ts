import type { Session } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { readJson, useReadFixture } from "@/tests/lib/omo/facade/read-fixture";

function insertRow(
  sqlite: import("better-sqlite3").Database,
  values: {
    readonly id: string;
    readonly kind?: "interactive" | "worker";
    readonly parent?: string | null;
    readonly replacedBy?: string | null;
    readonly title?: string;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO omo_session_index
       (workspace_id, durable_id, session_path, parent_durable_id, kind,
        replaced_by_durable_id, title, created_ms, updated_ms, updated_at)
       VALUES ('workspace-1', ?, ?, ?, ?, ?, ?, 10, 20, 30)`,
    )
    .run(
      values.id,
      `/sessions/${values.id}.jsonl`,
      values.parent ?? null,
      values.kind ?? "interactive",
      values.replacedBy ?? null,
      values.title ?? values.id,
    );
}

function isSdkSession(value: unknown): value is Session {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("projectID" in value) ||
    !("directory" in value) ||
    !("title" in value) ||
    !("time" in value)
  ) {
    return false;
  }
  const time = value.time;
  return (
    typeof value.id === "string" &&
    typeof value.projectID === "string" &&
    typeof value.directory === "string" &&
    typeof value.title === "string" &&
    typeof time === "object" &&
    time !== null &&
    "created" in time &&
    typeof time.created === "number" &&
    "updated" in time &&
    typeof time.updated === "number"
  );
}

describe("handleOmoRead session identities", () => {
  it("returns roots, children, and replacement successors from only the index", async () => {
    // Given
    const fixture = await useReadFixture();
    insertRow(fixture.sqlite, { id: "root", title: "Root" });
    insertRow(fixture.sqlite, {
      id: "child",
      kind: "worker",
      parent: "root",
    });
    insertRow(fixture.sqlite, { id: "old", replacedBy: "root" });

    // When
    const response = await fixture.request("/session/identities");

    // Then
    const body = await readJson(response);
    expect(body).toEqual({
      roots: ["omo_root"],
      children: ["omo_child"],
      replaced: [
        {
          old: "omo_old",
          new: "omo_root",
          info: {
            id: "omo_root",
            projectID: "workspace-1",
            directory: "/workspace",
            title: "Root",
            version: "omo",
            time: { created: 10, updated: 20 },
          },
        },
      ],
    });
    const replaced =
      typeof body === "object" && body !== null && "replaced" in body
        ? body.replaced
        : undefined;
    expect(
      Array.isArray(replaced) &&
        replaced.length === 1 &&
        typeof replaced[0] === "object" &&
        replaced[0] !== null &&
        "info" in replaced[0] &&
        isSdkSession(replaced[0].info),
    ).toBe(true);
    expect(fixture.source.list).not.toHaveBeenCalled();
    expect(fixture.source.readEntries).not.toHaveBeenCalled();
    expect(fixture.client.connect).not.toHaveBeenCalled();
    expect(fixture.client.request).not.toHaveBeenCalled();
  });

  it("touches a disk-only root before responding and skips unchanged writes", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.source.summaries.push({
      durableId: "disk-root",
      sessionPath: "/sessions/disk-root.jsonl",
      forkedFrom: null,
      title: "Disk root",
      createdMs: 100,
      updatedMs: 200,
    });

    // When
    await fixture.request("/session");
    const identities = await fixture.request("/session/identities");
    const before = fixture.sqlite
      .prepare("SELECT * FROM omo_session_index WHERE durable_id = ?")
      .get("disk-root");
    await fixture.request("/session");
    const after = fixture.sqlite
      .prepare("SELECT * FROM omo_session_index WHERE durable_id = ?")
      .get("disk-root");

    // Then
    expect(await readJson(identities)).toMatchObject({
      roots: ["omo_disk-root"],
    });
    expect(after).toEqual(before);
  });
});
