import { describe, expect, it } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  insertWriteIndexRow,
  namedWriteError,
  useWriteFixture,
  writeJson,
} from "@/tests/lib/omo/facade/write-fixture";

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
): JsonlRecord {
  return {
    type: "message",
    id,
    parentId,
    timestamp: 1,
    message: { role, content: id, timestamp: 1 },
  };
}

function configureRevert(
  fixture: Awaited<ReturnType<typeof useWriteFixture>>,
  entries: readonly JsonlRecord[],
  leafId: string,
  responseLeafId: string | null,
): void {
  fixture.source.authorized.add("root");
  insertWriteIndexRow(fixture.sqlite, {
    durableId: "root",
    leafKnown: 1,
    leafEntryId: leafId,
  });
  fixture.registry.request.mockImplementation(
    async (_binding, command): Promise<JsonlRecord> =>
      command["type"] === "get_entries"
        ? { data: { entries, leafId } }
        : { data: { outcome: "navigated", leafId: responseLeafId } },
  );
}

function storedLeaf(
  fixture: Awaited<ReturnType<typeof useWriteFixture>>,
): Record<string, unknown> {
  const value: unknown = fixture.sqlite
    .prepare(
      `SELECT leaf_known, leaf_entry_id FROM omo_session_index
       WHERE workspace_id = 'workspace-1' AND durable_id = 'root'`,
    )
    .get();
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function navigateCommand(
  fixture: Awaited<ReturnType<typeof useWriteFixture>>,
): JsonlRecord | undefined {
  return fixture.registry.request.mock.calls
    .map((call) => call[1])
    .find((command) => command["type"] === "navigate_tree");
}

describe("handleOmoWrite revert", () => {
  it("selects a user target and stores the response leaf", async () => {
    // Given
    const fixture = await useWriteFixture();
    configureRevert(
      fixture,
      [
        messageEntry("user-root", null, "user"),
        messageEntry("assistant", "user-root", "assistant"),
        messageEntry("user-target", "assistant", "user"),
        messageEntry("leaf", "user-target", "assistant"),
      ],
      "leaf",
      "assistant",
    );

    // When
    const response = await fixture.request("/session/omo_root/revert", {
      body: { messageID: "omo_user-target" },
    });

    // Then
    expect(response.status).toBe(204);
    expect(navigateCommand(fixture)).toEqual({
      type: "navigate_tree",
      entryId: "user-target",
      intent: "select",
      expectedLeafId: "leaf",
    });
    expect(storedLeaf(fixture)).toEqual({
      leaf_known: 1,
      leaf_entry_id: "assistant",
    });
  });

  it("stores a known empty leaf when reverting the root user", async () => {
    // Given
    const fixture = await useWriteFixture();
    configureRevert(
      fixture,
      [
        messageEntry("root-user", null, "user"),
        messageEntry("leaf", "root-user", "assistant"),
      ],
      "leaf",
      null,
    );

    // When
    await fixture.request("/session/omo_root/revert", {
      body: { messageID: "omo_root-user" },
    });

    // Then
    expect(storedLeaf(fixture)).toEqual({
      leaf_known: 1,
      leaf_entry_id: null,
    });
  });

  it("resumes the assistant target parent for undo", async () => {
    // Given
    const fixture = await useWriteFixture();
    configureRevert(
      fixture,
      [
        messageEntry("user", null, "user"),
        messageEntry("assistant", "user", "assistant"),
      ],
      "assistant",
      "user",
    );

    // When
    await fixture.request("/session/omo_root/revert", {
      body: { messageID: "omo_assistant" },
    });

    // Then
    expect(navigateCommand(fixture)).toEqual({
      type: "navigate_tree",
      entryId: "user",
      intent: "resume",
      expectedLeafId: "assistant",
    });
  });

  it("serializes a later appended entry after the reverted leaf", async () => {
    // Given
    const fixture = await useWriteFixture();
    configureRevert(
      fixture,
      [
        messageEntry("user", null, "user"),
        messageEntry("old", "user", "assistant"),
      ],
      "old",
      null,
    );
    await fixture.request("/session/omo_root/revert", {
      body: { messageID: "omo_user" },
    });
    const { setOmoLeafAndActivity } = await import("@/lib/omo/session-index");

    // When
    await fixture.registry.enqueueLeaf(fixture.workspace.id, "root", () =>
      setOmoLeafAndActivity(fixture.workspace.id, "root", "new", 50),
    );

    // Then
    expect(storedLeaf(fixture)).toEqual({
      leaf_known: 1,
      leaf_entry_id: "new",
    });
  });

  it("returns a leaf conflict when expectedLeafId is stale", async () => {
    // Given
    const fixture = await useWriteFixture();
    configureRevert(
      fixture,
      [
        messageEntry("user", null, "user"),
        messageEntry("leaf", "user", "assistant"),
      ],
      "leaf",
      "user",
    );
    fixture.registry.request.mockImplementation(async (_binding, command) => {
      if (command["type"] === "get_entries") {
        return {
          data: {
            entries: [
              messageEntry("user", null, "user"),
              messageEntry("leaf", "user", "assistant"),
            ],
            leafId: "leaf",
          },
        };
      }
      throw namedWriteError("OmoCommandError", {
        error: "stale",
        errorCode: "stale_leaf",
      });
    });

    // When
    const response = await fixture.request("/session/omo_root/revert", {
      body: { messageID: "omo_user" },
    });

    // Then
    expect(response.status).toBe(409);
    expect(await writeJson(response)).toEqual({ error: "leaf_changed" });
  });
});
