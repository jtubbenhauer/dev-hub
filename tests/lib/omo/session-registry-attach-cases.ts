import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRegistryFixture,
  entriesFixture,
  insertIndexRow,
  openFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

describe("OmoSessionRegistry attach coordination", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("opens by cwd and records the durable identity", async () => {
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "created",
        sessionPath: "/sessions/created.jsonl",
      }),
      entriesFixture([], null),
    ]);

    const binding = await fixture.runtime.registry.create({
      workspace: fixture.workspace,
    });

    expect(binding).toMatchObject({
      durableId: "created",
      routingHandle: "route-created",
      sessionPath: "/sessions/created.jsonl",
      state: "live",
    });
    await expect(
      fixture.runtime.registry.getIndexRow("workspace-1", "created"),
    ).resolves.toMatchObject({
      durableId: "created",
      sessionPath: "/sessions/created.jsonl",
    });
    expect(recordsOfType(fixture, "open_session")[0]).toMatchObject({
      cwd: fixture.workspace.path,
      retain_on_disconnect: true,
      kind: "interactive",
    });
  });

  it("reuses one binding for repeated and concurrent aliases", async () => {
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "known",
        sessionPath: "/sessions/known.jsonl",
        attached: true,
      }),
      entriesFixture([], null),
    ]);
    insertIndexRow(fixture.sqlite, {
      durableId: "known",
      sessionPath: "/sessions/known.jsonl",
    });

    const [byId, byPath, repeated] = await Promise.all([
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        durableId: "known",
      }),
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        sessionPath: "/sessions/known.jsonl",
      }),
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        durableId: "known",
      }),
    ]);
    const again = await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      sessionPath: "/sessions/known.jsonl",
    });

    expect(byPath).toBe(byId);
    expect(repeated).toBe(byId);
    expect(again).toBe(byId);
    expect(recordsOfType(fixture, "open_session")).toHaveLength(1);
    expect(fixture.runtime.registry.pendingAttach.size).toBe(0);
  });

  it("does not poison the open lock after a failed open", async () => {
    fixture = await createRegistryFixture([
      {
        type: "open_session",
        response: { success: false, error: "first failed" },
      },
      openFixture({ durableId: "retry", sessionPath: "/sessions/retry.jsonl" }),
      entriesFixture([], null),
    ]);

    await expect(
      fixture.runtime.registry.create({ workspace: fixture.workspace }),
    ).rejects.toThrow("first failed");
    await expect(
      fixture.runtime.registry.create({ workspace: fixture.workspace }),
    ).resolves.toMatchObject({ durableId: "retry" });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
  });

  it("refreshes non-authoritative workers before reopening with full context", async () => {
    const context = { role: "worker", task_id: "task-1", state_dir: "/state" };
    fixture = await createRegistryFixture((workspacePath) => [
      {
        type: "list_sessions",
        response: {
          data: {
            sessions: [
              {
                sessionId: "route-worker",
                durableSessionId: "worker",
                sessionPath: "/sessions/worker.jsonl",
                cwd: workspacePath,
                name: "Worker",
                kind: "worker",
                context,
              },
            ],
          },
        },
      },
      openFixture({
        durableId: "worker",
        routingHandle: "route-worker",
        sessionPath: "/sessions/worker.jsonl",
      }),
      entriesFixture([], null),
    ]);
    insertIndexRow(fixture.sqlite, {
      durableId: "worker",
      sessionPath: null,
      kind: "worker",
      contextAuthoritative: 0,
    });

    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "worker",
    });

    const records = fixture.host.connections[0]?.records ?? [];
    const listIndex = records.findIndex(
      (record) => record["type"] === "list_sessions",
    );
    const openIndex = records.findIndex(
      (record) => record["type"] === "open_session",
    );
    expect(openIndex).toBeGreaterThan(listIndex);
    expect(records[openIndex]).toMatchObject({ kind: "worker", context });
    await expect(
      fixture.runtime.registry.getIndexRow("workspace-1", "worker"),
    ).resolves.toMatchObject({ kind: "worker", contextAuthoritative: 1 });
  });

  it("reuses the global runtime after a module reload", async () => {
    fixture = await createRegistryFixture([]);
    const first = fixture.runtime;

    vi.resetModules();
    const { getOmoRuntime } = await import("@/lib/omo/session-registry");

    expect(getOmoRuntime(fixture.host.socketPath)).toBe(first);
  });
});
