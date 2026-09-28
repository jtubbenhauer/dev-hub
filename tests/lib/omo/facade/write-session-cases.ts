import { describe, expect, it } from "vitest";
import {
  createWriteBinding,
  insertWriteIndexRow,
  useWriteFixture,
  writeJson,
} from "@/tests/lib/omo/facade/write-fixture";

describe("handleOmoWrite session mutation routes", () => {
  it("creates a fresh cwd-only interactive session", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, { durableId: "created" });
    fixture.registry.create.mockResolvedValue(createWriteBinding("created"));

    // When
    const response = await fixture.request("/session", { body: {} });

    // Then
    expect(response.status).toBe(200);
    expect(await writeJson(response)).toMatchObject({ id: "omo_created" });
    expect(fixture.registry.create).toHaveBeenCalledWith({
      workspace: fixture.workspace,
    });
  });

  it("rejects delete while more than one attachment is active", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, { durableId: "root" });
    fixture.source.authorized.add("root");
    fixture.client.request.mockResolvedValue({
      data: {
        sessions: [{ durableSessionId: "root", attachments: 2 }],
      },
    });

    // When
    const response = await fixture.request("/session/omo_root", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(409);
    expect(await writeJson(response)).toEqual({ error: "session_in_use" });
    expect(fixture.source.remove).not.toHaveBeenCalled();
  });

  it("rejects delete when refresh cannot resolve a provisional path", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, {
      durableId: "provisional",
      sessionPath: null,
    });

    // When
    const response = await fixture.request("/session/omo_provisional", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(409);
    expect(await writeJson(response)).toEqual({
      error: "session_not_resolvable",
    });
    expect(fixture.registry.refreshIndexFromHost).toHaveBeenCalledOnce();
  });

  it("refuses to delete an indexed worker", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, {
      durableId: "worker",
      kind: "worker",
    });

    // When
    const response = await fixture.request("/session/omo_worker", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(403);
    expect(await writeJson(response)).toEqual({ error: "worker_session" });
  });

  it("rejects encoded traversal ids before source access", async () => {
    // Given
    const fixture = await useWriteFixture();

    // When
    const response = await fixture.request("/session/omo_..%2F..", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(404);
    expect(fixture.source.authorizeSession).not.toHaveBeenCalled();
    expect(fixture.source.remove).not.toHaveBeenCalled();
  });

  it("removes the contained file and index descendants on delete", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, { durableId: "parent" });
    insertWriteIndexRow(fixture.sqlite, {
      durableId: "child",
      kind: "worker",
      parentDurableId: "parent",
    });
    fixture.source.authorized.add("parent");
    fixture.client.request.mockResolvedValue({ data: { sessions: [] } });

    // When
    const response = await fixture.request("/session/omo_parent", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(204);
    expect(fixture.source.remove).toHaveBeenCalledWith("parent");
    const remaining = fixture.sqlite
      .prepare("SELECT durable_id FROM omo_session_index")
      .all();
    expect(remaining).toEqual([]);
  });

  it("deletes a session that has no persisted file yet", async () => {
    // Given
    const fixture = await useWriteFixture();
    const { OmoNotFoundError } = await import("@/lib/omo/session-source");
    insertWriteIndexRow(fixture.sqlite, { durableId: "fresh" });
    fixture.source.authorized.add("fresh");
    fixture.source.remove.mockRejectedValueOnce(new OmoNotFoundError("fresh"));
    fixture.client.request.mockResolvedValue({ data: { sessions: [] } });

    // When
    const response = await fixture.request("/session/omo_fresh", {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(204);
    const remaining = fixture.sqlite
      .prepare("SELECT durable_id FROM omo_session_index")
      .all();
    expect(remaining).toEqual([]);
  });

  it("returns 404 for an unauthorized rename and never attaches", async () => {
    // Given
    const fixture = await useWriteFixture();

    // When
    const response = await fixture.request("/session/omo_unknown", {
      method: "PATCH",
      body: { title: "New title" },
    });

    // Then
    expect(response.status).toBe(404);
    expect(await writeJson(response)).toEqual({ error: "session_not_found" });
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });

  it("persists a rename before successor metadata is cloned", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, { durableId: "old" });
    fixture.source.authorized.add("old");
    fixture.registry.attach.mockResolvedValue(createWriteBinding("old"));

    // When
    const response = await fixture.request("/session/omo_old", {
      method: "PATCH",
      body: { title: "Renamed" },
    });
    const { recordOmoSessionReplacement } =
      await import("@/lib/omo/session-index");
    await recordOmoSessionReplacement(
      fixture.workspace.id,
      "old",
      "new",
      "/sessions/new.jsonl",
    );
    const { handleOmoRead } = await import("@/lib/omo/facade/read");
    const identities = await handleOmoRead({
      method: "GET",
      path: "/session/identities",
      query: new URLSearchParams(),
      workspace: fixture.workspace,
      userId: "user-1",
    });

    // Then
    expect(response.status).toBe(200);
    expect(await writeJson(identities)).toMatchObject({
      replaced: [
        { old: "omo_old", new: "omo_new", info: { title: "Renamed" } },
      ],
    });
    expect(fixture.source.list).not.toHaveBeenCalled();
    expect(fixture.registry.emitEvent).toHaveBeenCalledWith(
      fixture.workspace.id,
      expect.objectContaining({ type: "session.updated" }),
    );
  });
});
