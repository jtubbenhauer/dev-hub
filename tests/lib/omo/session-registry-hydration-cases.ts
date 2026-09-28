import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import {
  createRegistryContext,
  entriesResponse,
  openedResponse,
  readIndexRow,
  receivedByType,
} from "@/tests/lib/omo/session-registry-fixture";

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  timestamp: number,
): JsonlRecord {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role,
      content: role === "user" ? id : [{ type: "text", text: id }],
      timestamp,
      ...(role === "assistant"
        ? { model: "model", provider: "provider", stopReason: "stop" }
        : {}),
    },
  };
}

function appended(entry: JsonlRecord): JsonlRecord {
  return { type: "entry_appended", entry, timestamp: entry["timestamp"] };
}

function insertLeafRow(
  context: Awaited<ReturnType<typeof createRegistryContext>>,
  durableId: string,
  sessionPath: string,
  leafKnown: number,
  leafEntryId: string | null,
): void {
  context.sqlite
    .prepare(
      `INSERT INTO omo_session_index
        (workspace_id, durable_id, session_path, kind, title, created_ms,
         updated_ms, leaf_known, leaf_entry_id, updated_at)
       VALUES (?, ?, ?, 'interactive', 'Leaf', 1, 2, ?, ?, 3)`,
    )
    .run(context.workspace.id, durableId, sessionPath, leafKnown, leafEntryId);
}

afterEach(() => {
  vi.doUnmock("@/lib/omo/adapter/live-events");
});

describe("OmoSessionRegistry hydration", () => {
  it("routes all pre-response records through the workspace adapter only", async () => {
    vi.doMock("@/lib/omo/adapter/live-events", () => ({
      createLiveAdapter: () => ({
        seed: () => undefined,
        handle: (record: JsonlRecord) => ({
          events: [
            {
              type: "session.updated",
              properties: { info: { id: String(record["index"]) } },
            },
          ],
          effects: [],
        }),
      }),
    }));
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({
          durableId: "buffered",
          sessionPath: "/sessions/buffered.jsonl",
        }),
      },
      { type: "get_entries", response: entriesResponse() },
    ]);
    context.host.preResponseEvents(3);
    const events: OmoRegistryEvent[] = [];
    const genericRecords: JsonlRecord[] = [];
    context.runtime.registry.subscribe(context.workspace.id, (event) =>
      events.push(event),
    );
    context.runtime.client.on((record) => {
      if (record["type"] === "fake_pre_response") genericRecords.push(record);
    });

    await context.runtime.registry.create({ workspace: context.workspace });

    expect(events.map((event) => event.properties)).toHaveLength(3);
    expect(genericRecords).toEqual([]);
  });

  it("restores a persisted leaf before seeding the adapter", async () => {
    const path = "/sessions/leaf.jsonl";
    const user = messageEntry("user", null, "user", 1);
    const hostLeaf = messageEntry("host-leaf", "user", "assistant", 2);
    const savedLeaf = messageEntry("saved-leaf", "user", "assistant", 3);
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({ durableId: "leaf", sessionPath: path }),
      },
      {
        type: "get_entries",
        response: entriesResponse({
          entries: [user, hostLeaf, savedLeaf],
          leafId: "host-leaf",
        }),
      },
      {
        type: "navigate_tree",
        response: { data: { outcome: "navigated", leafId: "saved-leaf" } },
      },
    ]);
    insertLeafRow(context, "leaf", path, 1, "saved-leaf");

    await context.runtime.registry.attach({
      workspace: context.workspace,
      durableId: "leaf",
    });

    expect(receivedByType(context, "navigate_tree")[0]).toMatchObject({
      entryId: "saved-leaf",
      intent: "resume",
      expectedLeafId: "host-leaf",
    });
  });

  it("adopts the host leaf when the stored leaf is absent", async () => {
    const path = "/sessions/missing-leaf.jsonl";
    const hostLeaf = messageEntry("host-leaf", null, "assistant", 2);
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({ durableId: "missing", sessionPath: path }),
      },
      {
        type: "get_entries",
        response: entriesResponse({ entries: [hostLeaf], leafId: "host-leaf" }),
      },
    ]);
    insertLeafRow(context, "missing", path, 1, "gone");

    await context.runtime.registry.attach({
      workspace: context.workspace,
      durableId: "missing",
    });
    await Promise.all(context.runtime.registry.leafQueue.values());

    expect(receivedByType(context, "navigate_tree")).toEqual([]);
    expect(readIndexRow(context, "missing")).toMatchObject({
      leaf_entry_id: "host-leaf",
    });
  });

  it("seeds before buffered replay so each assistant keeps its user parent", async () => {
    const path = "/sessions/replay.jsonl";
    const user1 = messageEntry("user-1", null, "user", 1);
    const assistant1 = messageEntry("assistant-1", "user-1", "assistant", 2);
    const user2 = messageEntry("user-2", "assistant-1", "user", 3);
    const assistant2 = messageEntry("assistant-2", "user-2", "assistant", 4);
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({ durableId: "replay", sessionPath: path }),
        events: [appended(assistant1), appended(user2), appended(assistant2)],
      },
      {
        type: "get_entries",
        response: entriesResponse({
          entries: [user1, assistant1, user2, assistant2],
          leafId: "assistant-2",
        }),
      },
    ]);
    const events: OmoRegistryEvent[] = [];
    context.runtime.registry.subscribe(context.workspace.id, (event) =>
      events.push(event),
    );

    await context.runtime.registry.attach({
      workspace: context.workspace,
      sessionPath: path,
    });

    const rekeys = events.filter((event) => event.type === "message.rekeyed");
    expect(rekeys).toHaveLength(3);
    expect(rekeys[0]).toMatchObject({
      properties: { info: { parentID: "omo_user-1" } },
    });
    expect(rekeys[2]).toMatchObject({
      properties: { info: { parentID: "omo_user-2" } },
    });
  });

  it("uses a second fence and emits resync after pre-bind overflow", async () => {
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({
          durableId: "overflow",
          sessionPath: "/sessions/overflow.jsonl",
        }),
      },
      { type: "get_entries", response: entriesResponse() },
      { type: "get_entries", response: entriesResponse() },
    ]);
    context.host.preResponseEvents(600);
    const events: OmoRegistryEvent[] = [];
    context.runtime.registry.subscribe(context.workspace.id, (event) =>
      events.push(event),
    );

    await context.runtime.registry.create({ workspace: context.workspace });

    expect(receivedByType(context, "get_entries")).toHaveLength(2);
    expect(events).toContainEqual({
      type: "session.resync_required",
      properties: { sessionID: "omo_overflow" },
    });
  });

  it("applies leaf effects without subscribers and isolates throwing sinks", async () => {
    const path = "/sessions/effects.jsonl";
    const entry = messageEntry("assistant", null, "assistant", 50);
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({ durableId: "effects", sessionPath: path }),
        events: [appended(entry)],
      },
      {
        type: "get_entries",
        response: entriesResponse({ entries: [entry], leafId: "assistant" }),
      },
    ]);
    const received: OmoRegistryEvent[] = [];
    context.runtime.registry.subscribe(context.workspace.id, () => {
      throw new Error("sink failed");
    });
    context.runtime.registry.subscribe(context.workspace.id, (event) =>
      received.push(event),
    );

    await context.runtime.registry.create({ workspace: context.workspace });
    await Promise.all(context.runtime.registry.leafQueue.values());

    expect(received).toHaveLength(1);
    expect(readIndexRow(context, "effects")).toMatchObject({
      leaf_entry_id: "assistant",
      updated_ms: 50_000,
    });
    expect(context.runtime.registry.leafQueue.size).toBe(0);
  });
});
