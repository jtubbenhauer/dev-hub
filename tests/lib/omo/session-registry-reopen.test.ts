// @vitest-environment node

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import {
  createRegistryFixture,
  entriesFixture,
  insertIndexRow,
  openFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

function unknownSessionFixture(type: string, sessionId: string) {
  return {
    type,
    sessionId,
    response: {
      success: false,
      error: "unknown session",
      errorCode: "unknown_session",
    },
  } as const;
}

describe("OmoSessionRegistry lifecycle reopening", () => {
  let fixture: RegistryFixture | undefined;
  const additionalRegistries: OmoSessionRegistry[] = [];

  afterEach(async () => {
    for (const registry of additionalRegistries.splice(0)) registry.dispose();
    await fixture?.close();
    fixture = undefined;
    vi.restoreAllMocks();
  });

  it("reopens a parked session before the next command", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "parked",
        routingHandle: "route-before-park",
        sessionPath: "/sessions/parked.jsonl",
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "parked",
        routingHandle: "route-after-park",
        sessionPath: "/sessions/parked.jsonl",
      }),
      entriesFixture([], null),
      {
        type: "get_state",
        sessionId: "route-after-park",
        response: { data: { status: "idle" } },
      },
    ]);
    const binding = await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "parked",
    });
    fixture.host.emit({
      type: "session_parked",
      sessionId: "route-before-park",
    });
    await vi.waitFor(() => expect(binding.state).toBe("detached"));

    // When
    await fixture.runtime.registry.request(binding, { type: "get_state" });

    // Then
    const lifecycleCommands = fixture.host.connections.flatMap((connection) =>
      connection.records.filter(
        (record) =>
          record["type"] === "open_session" || record["type"] === "get_state",
      ),
    );
    expect(lifecycleCommands.map((record) => record["type"])).toEqual([
      "open_session",
      "open_session",
      "get_state",
    ]);
    expect(lifecycleCommands[1]).toMatchObject({
      sessionPath: "/sessions/parked.jsonl",
    });
  });

  it("reopens and retries an idempotent command exactly once", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "retry-read",
        routingHandle: "route-stale",
        sessionPath: "/sessions/retry-read.jsonl",
      }),
      entriesFixture([], null),
      unknownSessionFixture("get_state", "route-stale"),
      openFixture({
        durableId: "retry-read",
        routingHandle: "route-fresh",
        sessionPath: "/sessions/retry-read.jsonl",
      }),
      entriesFixture([], null),
      {
        type: "get_state",
        sessionId: "route-fresh",
        response: { data: { status: "idle" } },
      },
    ]);
    const binding = await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "retry-read",
    });

    // When
    const response = await fixture.runtime.registry.request(binding, {
      type: "get_state",
    });

    // Then
    expect(response).toMatchObject({ data: { status: "idle" } });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
    expect(recordsOfType(fixture, "get_state")).toHaveLength(2);
  });

  it("reopens but does not retry a non-idempotent command", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "unsafe-write",
        routingHandle: "route-unsafe",
        sessionPath: "/sessions/unsafe-write.jsonl",
      }),
      entriesFixture([], null),
      unknownSessionFixture("prompt", "route-unsafe"),
      openFixture({
        durableId: "unsafe-write",
        routingHandle: "route-recovered",
        sessionPath: "/sessions/unsafe-write.jsonl",
      }),
      entriesFixture([], null),
    ]);
    const binding = await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "unsafe-write",
    });

    // When
    const error = await fixture.runtime.registry
      .request(binding, { type: "prompt", message: "hello" })
      .catch((caught: unknown) => caught);

    // Then
    expect(error).toMatchObject({
      name: "OmoEngineUnavailableError",
      code: "engine_unavailable",
      statusCode: 503,
    });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
    expect(recordsOfType(fixture, "prompt")).toHaveLength(1);
  });

  it("retries a path-in-use reopen using the host delay", async () => {
    // Given
    fixture = await createRegistryFixture([
      {
        type: "open_session",
        response: {
          success: false,
          error: "session path is in use",
          errorCode: "session_path_in_use",
          errorData: { retry_after_ms: 10 },
        },
      },
      openFixture({
        durableId: "path-retry",
        sessionPath: "/sessions/path-retry.jsonl",
      }),
      entriesFixture([], null),
    ]);
    insertIndexRow(fixture.sqlite, {
      durableId: "path-retry",
      sessionPath: "/sessions/path-retry.jsonl",
    });

    // When
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "path-retry",
    });

    // Then
    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
  });

  it("releases the open lock while retrying session_path_in_use so an unrelated attach is not blocked", async () => {
    // Given a retry delay long enough to observe blocking if the lock leaked
    fixture = await createRegistryFixture([
      {
        type: "open_session",
        response: {
          success: false,
          error: "session path is in use",
          errorCode: "session_path_in_use",
          errorData: { retry_after_ms: 200 },
        },
      },
      openFixture({
        durableId: "unrelated",
        sessionPath: "/sessions/unrelated.jsonl",
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "path-retry-b",
        sessionPath: "/sessions/path-retry-b.jsonl",
      }),
      entriesFixture([], null),
    ]);
    insertIndexRow(fixture.sqlite, {
      durableId: "path-retry-b",
      sessionPath: "/sessions/path-retry-b.jsonl",
    });

    // When the sleeping attach and an unrelated attach both start
    const sleepingAttach = fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "path-retry-b",
      sessionPath: "/sessions/path-retry-b.jsonl",
    });
    const startedAt = Date.now();
    const unrelatedAttach = fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "unrelated",
      sessionPath: "/sessions/unrelated.jsonl",
    });

    // Then the unrelated attach finishes well before the 200ms retry delay
    await unrelatedAttach;
    const unrelatedElapsedMs = Date.now() - startedAt;
    await sleepingAttach;

    expect(unrelatedElapsedMs).toBeLessThan(150);
  });

  it("reattaches only workspaces with active subscribers after reconnect", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "subscribed",
        sessionPath: "/sessions/subscribed.jsonl",
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "quiet",
        sessionPath: "/sessions/quiet.jsonl",
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "subscribed",
        routingHandle: "route-subscribed-reopened",
        sessionPath: "/sessions/subscribed.jsonl",
      }),
      entriesFixture([], null),
    ]);
    const reconnectFixture = fixture;
    const quietPath = join(reconnectFixture.workspacePath, "quiet");
    await mkdir(quietPath);
    const quietWorkspace = reconnectFixture.addWorkspace(
      "workspace-2",
      quietPath,
    );
    const { OmoSessionRegistry: Registry } =
      await import("@/lib/omo/session-registry-core");
    const registry = new Registry(reconnectFixture.runtime.client, {
      getSubscriberCount: (workspaceId) =>
        workspaceId === reconnectFixture.workspace.id ? 1 : 0,
    });
    additionalRegistries.push(registry);
    const subscribed = await registry.attach({
      workspace: reconnectFixture.workspace,
      durableId: "subscribed",
    });
    const quiet = await registry.attach({
      workspace: quietWorkspace,
      durableId: "quiet",
    });

    // When
    reconnectFixture.host.dropAll();
    await vi.waitFor(() => {
      expect(subscribed.state).toBe("detached");
      expect(quiet.state).toBe("detached");
    });
    await reconnectFixture.runtime.client.connect();
    await vi.waitFor(() => {
      expect(recordsOfType(reconnectFixture, "open_session")).toHaveLength(3);
    });

    // Then
    expect(recordsOfType(reconnectFixture, "open_session")[2]).toMatchObject({
      sessionPath: "/sessions/subscribed.jsonl",
    });
    expect(quiet.state).toBe("detached");
  });

  it("logs memory pressure without blocking a later interactive open", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "after-pressure",
        sessionPath: "/sessions/after-pressure.jsonl",
      }),
      entriesFixture([], null),
    ]);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await fixture.runtime.client.connect();
    fixture.host.emit({ type: "host_memory_pressure", usage: 0.95 });
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith("OmO host memory pressure", {
        usage: 0.95,
      });
    });

    // When
    await fixture.runtime.registry.create({ workspace: fixture.workspace });

    // Then
    expect(recordsOfType(fixture, "open_session")).toHaveLength(1);
  });
});
