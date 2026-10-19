// @vitest-environment node

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { LiveAdapterResult } from "@/lib/omo/adapter/live-adapter-types";
import type { DialogAdapter } from "@/lib/omo/adapter/dialogs";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { OmoRpcClient, UnixSocketTransport } from "@/lib/omo/rpc-client";
import type { OmoRegistryDispatcher } from "@/lib/omo/session-registry-dispatch";
import { OmoRegistryRecordBuffer } from "@/lib/omo/session-registry-lock";
import { createOmoBindingReady } from "@/lib/omo/session-registry-ready";
import type {
  OmoRegistryEvent,
  OmoSessionBinding,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry-types";
import { createRegistryTestDatabase } from "@/tests/lib/omo/session-registry-db-fixture";

function createUnconnectedClient(): OmoRpcClient {
  return new OmoRpcClient({
    transport: new UnixSocketTransport({
      socketPath: "/tmp/devhub-omo-dispatch-test-unused.sock",
    }),
  });
}

const WORKSPACE: OmoSessionRegistryWorkspace = {
  id: "workspace-1",
  path: "/workspace",
};

type TestBinding = {
  readonly binding: OmoSessionBinding;
  setHandle: (handle: (record: JsonlRecord) => LiveAdapterResult) => void;
};

function createTestBinding(
  durableId: string,
  initialHandle: (record: JsonlRecord) => LiveAdapterResult,
): TestBinding {
  let currentHandle = initialHandle;
  const dialogs: DialogAdapter = {
    handle: () => [],
    ingestPendingQuestions: () => [],
    eventsForSubscriber: () => [],
    reply: async () => ({ status: 204 }),
    reject: async () => ({ status: 204 }),
  };
  const binding: OmoSessionBinding = {
    workspace: WORKSPACE,
    workspaceId: WORKSPACE.id,
    canonicalWorkspacePath: WORKSPACE.path,
    durableId,
    routingHandle: `route-${durableId}`,
    sessionPath: null,
    generation: 1,
    adapter: {
      seed: () => undefined,
      linkTaskChild: () => [],
      handle: (record) => currentHandle(record),
    },
    dialogs,
    openedState: {
      durableId,
      sessionPath: null,
      title: "Untitled",
      isStreaming: false,
      modelId: undefined,
      providerId: undefined,
      record: {},
    },
    ...createOmoBindingReady(),
    unregisterSession: () => undefined,
    buffer: new OmoRegistryRecordBuffer(),
    effectTail: Promise.resolve(),
    state: "live",
    failure: undefined,
  };
  return {
    binding,
    setHandle: (handle) => {
      currentHandle = handle;
    },
  };
}

describe("OmoRegistryDispatcher", () => {
  let sqlite: Database.Database;
  let Dispatcher: typeof OmoRegistryDispatcher;

  beforeEach(async () => {
    vi.resetModules();
    sqlite = createRegistryTestDatabase();
    vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
    ({ OmoRegistryDispatcher: Dispatcher } =
      await import("@/lib/omo/session-registry-dispatch"));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    sqlite.close();
  });

  it("tracks only the latest status per session instead of an unbounded event log", () => {
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex: async () => undefined,
      findSubAgentSessionIds: async () => [],
    });
    const { binding, setHandle } = createTestBinding("s1", () => ({
      events: [],
      effects: [],
    }));

    setHandle(() => ({
      events: [
        {
          type: "session.status",
          properties: { sessionID: "omo_s1", status: { type: "busy" } },
        },
      ],
      effects: [],
    }));
    dispatcher.dispatch(binding, { type: "agent_start" });
    setHandle(() => ({
      events: [
        {
          type: "session.status",
          properties: { sessionID: "omo_s1", status: { type: "idle" } },
        },
      ],
      effects: [],
    }));
    dispatcher.dispatch(binding, { type: "agent_settled" });

    expect(dispatcher.sessionStatusesForWorkspace(WORKSPACE.id)).toEqual({
      omo_s1: { type: "idle" },
    });
    dispatcher.deleteSessionStatus(WORKSPACE.id, "omo_s1");
    expect(dispatcher.sessionStatusesForWorkspace(WORKSPACE.id)).toEqual({});
  });

  it("recovers from a failing merge effect so a later leaf write still lands", async () => {
    sqlite
      .prepare(
        `INSERT INTO omo_session_index
          (workspace_id, durable_id, session_path, kind, title, created_ms,
           updated_ms, updated_at)
         VALUES ('workspace-1', 's2', NULL, 'interactive', 'S2', 1, 2, 3)`,
      )
      .run();
    const refreshIndex = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh boom"))
      .mockResolvedValue(undefined);
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex,
      findSubAgentSessionIds: async () => [],
    });
    const { binding, setHandle } = createTestBinding("s2", () => ({
      events: [],
      effects: [
        {
          mergeFromTaskEvent: {
            durableId: "child-1",
            workspaceId: WORKSPACE.id,
            parentDurableId: "s2",
            kind: "worker",
            title: "child",
            createdMs: 1,
            updatedMs: 2,
          },
          refreshIndex: true,
        },
      ],
    }));

    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    setHandle(() => ({ events: [], effects: [] }));
    dispatcher.dispatch(binding, {
      type: "entry_appended",
      entry: { id: "entry-1", timestamp: 5 },
    });
    await binding.effectTail;

    const row = sqlite
      .prepare(
        "SELECT leaf_entry_id FROM omo_session_index WHERE durable_id = 's2'",
      )
      .get() as { readonly leaf_entry_id: string | null } | undefined;
    expect(row?.leaf_entry_id).toBe("entry-1");
    expect(errorLog).toHaveBeenCalled();
  });

  it("links a task worker once and reports its status when it changes", async () => {
    sqlite
      .prepare(
        `INSERT INTO omo_session_index
          (workspace_id, durable_id, session_path, kind, context,
           context_authoritative, title, created_ms, updated_ms, updated_at)
         VALUES ('workspace-1', 'worker-1', NULL, 'worker',
           '{"role":"child","task_id":"st_task-1"}', 1, 'Untitled', 10, 10, 10)`,
      )
      .run();
    const refreshIndex = vi.fn(async () => undefined);
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex,
      findSubAgentSessionIds: async () => [],
    });
    const events: unknown[] = [];
    dispatcher.subscribe(WORKSPACE.id, (event) => events.push(event));
    let isActive = true;
    const { binding } = createTestBinding("parent-1", () => ({
      events: [],
      effects: [
        {
          linkTaskChild: {
            parentDurableId: "parent-1",
            taskId: "st_task-1",
            title: "Read math.ts",
            updatedMs: 20,
            isActive,
          },
        },
      ],
    }));

    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;
    const whileRunning = dispatcher.sessionStatusesForWorkspace(WORKSPACE.id);
    isActive = false;
    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;

    const row = sqlite
      .prepare(
        "SELECT parent_durable_id, title FROM omo_session_index WHERE durable_id = 'worker-1'",
      )
      .get();
    expect(row).toEqual({
      parent_durable_id: "parent-1",
      title: "Read math.ts",
    });
    expect(refreshIndex).toHaveBeenCalledOnce();
    expect(whileRunning).toEqual({ "omo_worker-1": { type: "busy" } });
    expect(dispatcher.sessionStatusesForWorkspace(WORKSPACE.id)).toEqual({
      "omo_worker-1": { type: "idle" },
    });
    expect(events).toMatchObject([
      {
        type: "session.updated",
        properties: {
          info: { id: "omo_worker-1", parentID: "omo_parent-1" },
        },
      },
      {
        type: "session.status",
        properties: { sessionID: "omo_worker-1", status: { type: "busy" } },
      },
      {
        type: "session.status",
        properties: { sessionID: "omo_worker-1", status: { type: "idle" } },
      },
    ]);
  });

  it("links an out-of-process worker that only its transcript on disk names", async () => {
    const findSubAgentSessionIds = vi.fn(
      async (_workspace: OmoSessionRegistryWorkspace, taskId: string) =>
        taskId === "st_task-3" ? ["worker-3"] : [],
    );
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex: async () => undefined,
      findSubAgentSessionIds,
    });
    const events: OmoRegistryEvent[] = [];
    dispatcher.subscribe(WORKSPACE.id, (event) => events.push(event));
    const { binding } = createTestBinding("parent-3", () => ({
      events: [],
      effects: [
        {
          linkTaskChild: {
            parentDurableId: "parent-3",
            taskId: "st_task-3",
            title: "Gate deposits UI",
            category: "deep-low",
            updatedMs: 30,
            isActive: true,
          },
        },
      ],
    }));
    const linkTaskChild = vi.spyOn(binding.adapter, "linkTaskChild");

    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;
    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;

    expect(findSubAgentSessionIds).toHaveBeenCalledOnce();
    expect(findSubAgentSessionIds).toHaveBeenCalledWith(WORKSPACE, "st_task-3");
    expect(
      sqlite
        .prepare(
          "SELECT kind, parent_durable_id, title FROM omo_session_index WHERE durable_id = 'worker-3'",
        )
        .get(),
    ).toEqual({
      kind: "worker",
      parent_durable_id: "parent-3",
      title: "Gate deposits UI",
    });
    expect(linkTaskChild).toHaveBeenCalledWith("st_task-3", "omo_worker-3");
    expect(dispatcher.sessionStatusesForWorkspace(WORKSPACE.id)).toEqual({
      "omo_worker-3": { type: "busy" },
    });
    expect(events[0]).toMatchObject({
      type: "session.updated",
      properties: {
        info: { id: "omo_worker-3", parentID: "omo_parent-3" },
      },
    });
  });

  it("forwards a linked worker's progress after its status, sending an unchanged status once", async () => {
    // Given
    sqlite
      .prepare(
        `INSERT INTO omo_session_index
          (workspace_id, durable_id, session_path, kind, context,
           context_authoritative, title, created_ms, updated_ms, updated_at)
         VALUES ('workspace-1', 'worker-2', NULL, 'worker',
           '{"role":"child","task_id":"st_task-2"}', 1, 'Untitled', 10, 10, 10)`,
      )
      .run();
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex: async () => undefined,
      findSubAgentSessionIds: async () => [],
    });
    const events: OmoRegistryEvent[] = [];
    dispatcher.subscribe(WORKSPACE.id, (event) => events.push(event));
    let summary = "turn 1 · running";
    const { binding } = createTestBinding("parent-2", () => ({
      events: [],
      effects: [
        {
          linkTaskChild: {
            parentDurableId: "parent-2",
            taskId: "st_task-2",
            title: "Run ls",
            updatedMs: 20,
            isActive: true,
            activity: { summary, turns: 1, updatedAt: 20 },
          },
        },
      ],
    }));

    // When
    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;
    summary = "turn 2 · running";
    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });

    // Then
    expect(events.filter((event) => event.type !== "session.updated")).toEqual([
      {
        type: "session.status",
        properties: { sessionID: "omo_worker-2", status: { type: "busy" } },
      },
      {
        type: "session.activity",
        properties: {
          sessionID: "omo_worker-2",
          activity: { summary: "turn 1 · running", turns: 1, updatedAt: 20 },
        },
      },
      {
        type: "session.activity",
        properties: {
          sessionID: "omo_worker-2",
          activity: { summary: "turn 2 · running", turns: 1, updatedAt: 20 },
        },
      },
    ]);
  });

  it("sends a background status only when a line changes and withdraws it once", () => {
    // Given
    const dispatcher = new Dispatcher({
      client: createUnconnectedClient(),
      refreshIndex: async () => undefined,
      findSubAgentSessionIds: async () => [],
    });
    let text: string | undefined = "Pursuing goal (1m)";
    const { binding } = createTestBinding("goal-1", () => ({
      events: [],
      effects: [{ backgroundStatus: { key: "goal", text } }],
    }));
    const events: OmoRegistryEvent[] = [];
    dispatcher.subscribe(WORKSPACE.id, (event) => events.push(event));

    // When
    dispatcher.dispatch(binding, { type: "extension_ui_request" });
    dispatcher.dispatch(binding, { type: "extension_ui_request" });
    text = undefined;
    dispatcher.dispatch(binding, { type: "extension_ui_request" });
    dispatcher.clearBackgroundStatus(WORKSPACE.id, "omo_goal-1");

    // Then
    expect(events).toEqual([
      {
        type: "session.background",
        properties: {
          sessionID: "omo_goal-1",
          status: { goal: "Pursuing goal (1m)", goalState: "active" },
        },
      },
      {
        type: "session.background",
        properties: { sessionID: "omo_goal-1", status: null },
      },
    ]);
    expect(dispatcher.backgroundStatusesForWorkspace(WORKSPACE.id)).toEqual({});
  });
});
