import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOmoWorkspaceEventStream } from "@/lib/omo/event-stream";
import {
  ASSISTANT_MESSAGE_START,
  parseSseFrame,
  readSseFrame,
} from "@/tests/lib/omo/event-stream-fixture";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

const realSetImmediate = globalThis.setImmediate;

describe("createOmoWorkspaceEventStream lifecycle", () => {
  let fixture: RegistryFixture | undefined;
  const disposers: Array<() => void> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    await fixture?.close();
    fixture = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("emits disconnected and connected states around a host reconnect", async () => {
    // Given
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fixture = await createRegistryFixture([]);
    await fixture.runtime.client.connect();
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();

    // When
    fixture.host.dropAll();

    // Then
    expect(parseSseFrame(await readSseFrame(reader))).toEqual({
      workspaceId: "workspace-1",
      event: {
        type: "workspace.connection",
        properties: { status: "disconnected" },
      },
    });
    const connectedFrame = readSseFrame(reader);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(parseSseFrame(await connectedFrame)).toEqual({
      workspaceId: "workspace-1",
      event: {
        type: "workspace.connection",
        properties: { status: "connected" },
      },
    });
  });

  it("emits the canonical keepalive comment every 30 seconds", async () => {
    // Given
    vi.useFakeTimers();
    fixture = await createRegistryFixture([]);
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const frame = readSseFrame(eventStream.stream.getReader());

    // When
    await vi.advanceTimersByTimeAsync(30_000);

    // Then
    await expect(frame).resolves.toBe(": keepalive\n\n");
  });

  it("cancels idempotently and ignores a late host record", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "cancel",
        sessionPath: "/sessions/cancel.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "cancel",
    });
    const listenerCount = fixture.runtime.client.listenerCount();
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();
    expect(fixture.runtime.client.listenerCount()).toBe(listenerCount + 1);
    expect(fixture.runtime.registry.subscriberCount("workspace-1")).toBe(1);

    // When
    await reader.cancel();
    eventStream.dispose();
    eventStream.dispose();
    fixture.host.emit({
      ...ASSISTANT_MESSAGE_START,
      sessionId: "route-cancel",
    });
    await new Promise<void>((resolve) => realSetImmediate(resolve));

    // Then
    expect(fixture.runtime.client.listenerCount()).toBe(listenerCount);
    expect(fixture.runtime.registry.subscriberCount("workspace-1")).toBe(0);
  });

  it("disposes and closes when the caller aborts its signal", async () => {
    // Given
    fixture = await createRegistryFixture([]);
    const abortController = new AbortController();
    const listenerCount = fixture.runtime.client.listenerCount();
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: abortController.signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();

    // When
    abortController.abort();

    // Then
    await expect(reader.closed).resolves.toBeUndefined();
    expect(fixture.runtime.client.listenerCount()).toBe(listenerCount);
    expect(fixture.runtime.registry.subscriberCount("workspace-1")).toBe(0);
  });

  it("reattaches only bindings with a workspace subscriber", async () => {
    // Given
    fixture = await createRegistryFixture((workspacePath) => [
      openFixture({
        durableId: "subscribed",
        sessionPath: `${workspacePath}/subscribed.jsonl`,
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "quiet",
        sessionPath: `${workspacePath}/quiet/quiet.jsonl`,
      }),
      entriesFixture([], null),
      openFixture({
        durableId: "subscribed",
        routingHandle: "route-subscribed-reopened",
        sessionPath: `${workspacePath}/subscribed.jsonl`,
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
    const subscribed = await reconnectFixture.runtime.registry.attach({
      workspace: reconnectFixture.workspace,
      durableId: "subscribed",
    });
    const quiet = await reconnectFixture.runtime.registry.attach({
      workspace: quietWorkspace,
      durableId: "quiet",
    });
    const eventStream = createOmoWorkspaceEventStream({
      workspace: reconnectFixture.workspace,
      runtime: reconnectFixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();
    expect(
      reconnectFixture.runtime.registry.subscriberCount("workspace-1"),
    ).toBe(1);

    // When
    reconnectFixture.host.dropAll();
    await vi.waitFor(() => {
      expect(subscribed.state).toBe("detached");
      expect(quiet.state).toBe("detached");
    });
    await readSseFrame(reader);
    await reconnectFixture.runtime.client.connect();
    await readSseFrame(reader);
    await vi.waitFor(() => {
      expect(recordsOfType(reconnectFixture, "open_session")).toHaveLength(3);
    });

    // Then
    expect(recordsOfType(reconnectFixture, "open_session")[2]).toMatchObject({
      sessionPath: `${reconnectFixture.workspacePath}/subscribed.jsonl`,
    });
    expect(quiet.state).toBe("detached");
  });
});
