import { describe, expect, it, vi } from "vitest";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import {
  createRegistryContext,
  entriesResponse,
  openedResponse,
  readIndexRow,
  receivedByType,
} from "@/tests/lib/omo/session-registry-fixture";

function insertOldRow(
  context: Awaited<ReturnType<typeof createRegistryContext>>,
  path: string,
): void {
  context.sqlite
    .prepare(
      `INSERT INTO omo_session_index
        (workspace_id, durable_id, session_path, parent_durable_id, kind,
         agent, category, context, context_authoritative, title, created_ms,
         updated_ms, updated_at)
       VALUES (?, 'old', ?, 'parent', 'worker', 'explore', 'deep',
               '{"task_id":"task-1"}', 1, 'Old', 1, 2, 3)`,
    )
    .run(context.workspace.id, path);
}

describe("OmoSessionRegistry successor handoff", () => {
  it("refuses an indexed replaced id without opening it", async () => {
    const context = await createRegistryContext([]);
    context.sqlite
      .prepare(
        `INSERT INTO omo_session_index
          (workspace_id, durable_id, session_path, kind,
           replaced_by_durable_id, title, created_ms, updated_ms, updated_at)
         VALUES (?, 'old', NULL, 'interactive', 'new', 'Old', 1, 2, 3)`,
      )
      .run(context.workspace.id);

    const thrown = await context.runtime.registry
      .attach({ workspace: context.workspace, durableId: "old" })
      .catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      name: "OmoSessionReplacedError",
      newDurableId: "new",
    });
    expect(receivedByType(context, "open_session")).toEqual([]);
  });

  it("moves a live binding to its successor and emits the ordered events", async () => {
    const path = "/sessions/successor.jsonl";
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({
          routingHandle: "route-old",
          durableId: "old",
          sessionPath: path,
        }),
      },
      { type: "get_entries", response: entriesResponse() },
      { type: "get_entries", response: entriesResponse() },
    ]);
    insertOldRow(context, path);
    await context.runtime.registry.attach({
      workspace: context.workspace,
      durableId: "old",
    });
    const events: OmoRegistryEvent[] = [];
    const moved = new Promise<void>((resolve) => {
      context.runtime.registry.subscribe(context.workspace.id, (event) => {
        events.push(event);
        if (event.type === "session.metadata_moved") resolve();
      });
    });

    // A dialog asked on the old routing handle just before the handoff must
    // survive and be re-asked under the successor's session id.
    context.host.emit({
      type: "extension_ui_request",
      sessionId: "route-old",
      id: "uuid-pre-handoff-1",
      method: "confirm",
      title: "Continue?",
      message: "Proceed with the risky step?",
    });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "question.asked")).toBe(
        true,
      );
    });
    events.length = 0;

    context.host.emit({
      type: "session_replaced",
      sessionId: "route-old",
      durableSessionId: "new",
      sessionFile: path,
    });
    await moved;

    expect(events.map((event) => event.type)).toEqual([
      "session.created",
      "session.deleted",
      "question.asked",
      "session.metadata_moved",
    ]);
    const rekeyed = events.find((event) => event.type === "question.asked");
    expect(rekeyed).toMatchObject({
      properties: { sessionID: "omo_new" },
    });
    expect(
      context.runtime.registry.findBinding(context.workspace.id, "old", null),
    ).toBeUndefined();
    expect(
      context.runtime.registry.findBinding(context.workspace.id, "new", path),
    ).toMatchObject({ state: "live", routingHandle: "route-old" });
    expect(readIndexRow(context, "old")).toMatchObject({
      session_path: null,
      replaced_by_durable_id: "new",
    });
    expect(readIndexRow(context, "new")).toMatchObject({
      parent_durable_id: "parent",
      agent: "explore",
      category: "deep",
      context: '{"task_id":"task-1"}',
      context_authoritative: 1,
    });
  });

  it("rejects old hydration waiters and hydrates a buffered successor", async () => {
    const path = "/sessions/buffered-successor.jsonl";
    const context = await createRegistryContext([
      {
        type: "open_session",
        response: openedResponse({
          routingHandle: "route-old",
          durableId: "old",
          sessionPath: path,
        }),
        events: [
          {
            type: "session_replaced",
            sessionId: "route-old",
            durableSessionId: "new",
            sessionFile: path,
          },
        ],
      },
      { type: "get_entries", response: entriesResponse() },
    ]);
    insertOldRow(context, path);
    const eventTypes: string[] = [];
    const moved = new Promise<void>((resolve) => {
      context.runtime.registry.subscribe(context.workspace.id, (event) => {
        eventTypes.push(event.type);
        if (event.type === "session.metadata_moved") resolve();
      });
    });

    await expect(
      context.runtime.registry.attach({
        workspace: context.workspace,
        durableId: "old",
      }),
    ).rejects.toMatchObject({
      name: "OmoSessionReplacedError",
      newDurableId: "new",
    });
    await moved;

    expect(eventTypes.slice(0, 2)).toEqual([
      "session.created",
      "session.deleted",
    ]);
    expect(
      context.runtime.registry.findBinding(context.workspace.id, "new", path),
    ).toMatchObject({ state: "live" });
    expect(context.runtime.registry.pendingAttach.size).toBe(0);
  });
});
