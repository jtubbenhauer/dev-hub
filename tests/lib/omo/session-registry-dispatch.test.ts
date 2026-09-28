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

  it("links a task worker to its parent through context.task_id once", async () => {
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
    });
    const events: unknown[] = [];
    dispatcher.subscribe(WORKSPACE.id, (event) => events.push(event));
    const link = {
      linkTaskChild: {
        parentDurableId: "parent-1",
        taskId: "st_task-1",
        title: "Read math.ts",
        updatedMs: 20,
      },
    };
    const { binding } = createTestBinding("parent-1", () => ({
      events: [],
      effects: [link],
    }));

    dispatcher.dispatch(binding, { type: "extension_event", name: "x" });
    await binding.effectTail;
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
    expect(events).toMatchObject([
      {
        type: "session.updated",
        properties: {
          info: { id: "omo_worker-1", parentID: "omo_parent-1" },
        },
      },
    ]);
  });
});
