import { afterEach, describe, expect, it } from "vitest";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: Date.now(),
    message: {
      role,
      content: role === "user" ? text : [{ type: "text", text }],
      ...(role === "assistant"
        ? { model: "model", provider: "provider", stopReason: "stop" }
        : {}),
    },
  } as const;
}

function rekeyEvents(events: readonly OmoRegistryEvent[]) {
  return events.filter((event) => event.type === "message.rekeyed");
}

describe("OmoSessionRegistry buffered replay", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("links a mid-turn assistant to the buffered durable user", async () => {
    const user = messageEntry("user-mid", null, "user", "question");
    const assistant = messageEntry(
      "assistant-mid",
      "user-mid",
      "assistant",
      "answer",
    );
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "mid-turn",
        sessionPath: "/sessions/mid-turn.jsonl",
        events: [
          { type: "entry_appended", sessionId: "route-mid-turn", entry: user },
          {
            type: "entry_appended",
            sessionId: "route-mid-turn",
            entry: assistant,
          },
        ],
      }),
      entriesFixture([user, assistant], "assistant-mid"),
    ]);
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe("workspace-1", (event) =>
      events.push(event),
    );

    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "mid-turn",
    });

    const assistantEvent = rekeyEvents(events).find(
      (event) => event.properties.toMessageID === "omo_assistant-mid",
    );
    expect(assistantEvent?.properties.info).toMatchObject({
      parentID: "omo_user-mid",
    });
  });

  it("seeds before the earliest buffered append and preserves parent chaining", async () => {
    const user1 = messageEntry("user-1", null, "user", "one");
    const assistant1 = messageEntry("assistant-1", "user-1", "assistant", "a1");
    const user2 = messageEntry("user-2", "assistant-1", "user", "two");
    const assistant2 = messageEntry("assistant-2", "user-2", "assistant", "a2");
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "chain",
        sessionPath: "/sessions/chain.jsonl",
        events: [assistant1, user2, assistant2].map((entry) => ({
          type: "entry_appended",
          sessionId: "route-chain",
          entry,
        })),
      }),
      entriesFixture([user1, assistant1, user2, assistant2], "assistant-2"),
    ]);
    const rawEvents: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe("workspace-1", (event) =>
      rawEvents.push(event),
    );

    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "chain",
    });

    const events = rekeyEvents(rawEvents);
    expect(events).toHaveLength(3);
    expect(
      events.find((event) => event.properties.toMessageID === "omo_assistant-1")
        ?.properties.info,
    ).toMatchObject({ parentID: "omo_user-1" });
    expect(
      events.find((event) => event.properties.toMessageID === "omo_assistant-2")
        ?.properties.info,
    ).toMatchObject({ parentID: "omo_user-2" });
    expect(
      new Set(events.map((event) => event.properties.toMessageID)).size,
    ).toBe(3);
  });
});
