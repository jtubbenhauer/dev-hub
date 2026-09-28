import { afterEach, describe, expect, it } from "vitest";
import { createOmoWorkspaceEventStream } from "@/lib/omo/event-stream";
import { getOmoDialogLedger } from "@/lib/omo/facade/read-runtime";
import {
  ASSISTANT_MESSAGE_START,
  ASSISTANT_TEXT_START,
  attachFixtureSession,
  parseSseFrame,
  readSseFrame,
} from "@/tests/lib/omo/event-stream-fixture";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

describe("createOmoWorkspaceEventStream delivery", () => {
  let fixture: RegistryFixture | undefined;
  const disposers: Array<() => void> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    await fixture?.close();
    fixture = undefined;
  });

  it("wraps normalized events in the canonical workspace data frame", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "wire",
        sessionPath: "/sessions/wire.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await attachFixtureSession(fixture, "wire");
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();

    // When
    fixture.host.emit({
      ...ASSISTANT_MESSAGE_START,
      sessionId: "route-wire",
    });

    // Then
    expect(parseSseFrame(await readSseFrame(reader))).toMatchObject({
      workspaceId: "workspace-1",
      event: {
        type: "message.updated",
        properties: { info: { id: expect.stringMatching(/^omo_live_/) } },
      },
    });
  });

  it("observes sessions attached after the stream starts", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "late",
        sessionPath: "/sessions/late.jsonl",
        events: [ASSISTANT_MESSAGE_START],
      }),
      entriesFixture([], null),
    ]);
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    const reader = eventStream.stream.getReader();

    // When
    await attachFixtureSession(fixture, "late");

    // Then
    expect(parseSseFrame(await readSseFrame(reader))).toMatchObject({
      workspaceId: "workspace-1",
      event: {
        type: "workspace.connection",
        properties: { status: "connected" },
      },
    });
    expect(parseSseFrame(await readSseFrame(reader))).toMatchObject({
      workspaceId: "workspace-1",
      event: { type: "message.updated" },
    });
  });

  it("multicasts byte-identical provisional events to overlapping streams", async () => {
    // Given
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "shared",
        sessionPath: "/sessions/shared.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await attachFixtureSession(fixture, "shared");
    const first = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    const second = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(first.dispose, second.dispose);
    const firstReader = first.stream.getReader();
    const secondReader = second.stream.getReader();

    // When
    fixture.host.emit({
      ...ASSISTANT_MESSAGE_START,
      sessionId: "route-shared",
    });
    const firstFrame = await readSseFrame(firstReader);
    const secondFrame = await readSseFrame(secondReader);

    // Then
    expect(secondFrame).toBe(firstFrame);
    expect(parseSseFrame(firstFrame)).toMatchObject({
      event: {
        properties: { info: { id: expect.stringMatching(/^omo_live_/) } },
      },
    });
    await firstReader.cancel();
    expect(fixture.runtime.registry.subscriberCount("workspace-1")).toBe(1);
    fixture.host.emit({
      ...ASSISTANT_TEXT_START,
      sessionId: "route-shared",
    });
    expect(parseSseFrame(await readSseFrame(secondReader))).toMatchObject({
      event: { type: "message.part.updated" },
    });
  });

  it("replays unresolved select dialogs when the stream starts", async () => {
    // Given
    fixture = await createRegistryFixture([]);
    const ledger = getOmoDialogLedger(fixture.runtime);
    const entry = ledger.register({
      routingHandle: "route-question",
      durableId: "question",
      workspaceId: fixture.workspace.id,
      extUiId: "select-open",
      method: "select",
      request: {
        sessionID: "omo_question",
        questions: [
          {
            header: "Choose",
            question: "Choose",
            options: [{ label: "One", description: "" }],
            multiple: false,
            custom: false,
          },
        ],
      },
    });

    // When
    const eventStream = createOmoWorkspaceEventStream({
      workspace: fixture.workspace,
      runtime: fixture.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);

    // Then
    expect(
      parseSseFrame(await readSseFrame(eventStream.stream.getReader())),
    ).toEqual({
      workspaceId: "workspace-1",
      event: { type: "question.asked", properties: entry.payload },
    });
  });
});
