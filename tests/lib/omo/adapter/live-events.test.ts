// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import type {
  Event,
  MessageRekeyedEvent,
} from "@/lib/opencode/types";

const OPTIONS = {
  sessionId: "omo_durable-text-1",
  workspaceId: "workspace-1",
  workspacePath: "/workspace",
  skillPrefixes: ["frontend", "debugging"],
} as const;

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(name: string): JsonlRecord[] {
  return readFileSync(
    join(process.cwd(), "tests/fixtures/omo", `${name}.jsonl`),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new TypeError("fixture line is not a record");
      return parsed;
    });
}

function replay(name: string): Event[] {
  const adapter = createLiveAdapter(OPTIONS);
  adapter.seed({
    lastUserMessageID: "omo_entry-text-user-1",
    lastKnownModel: "seed-model",
    lastKnownProvider: "seed-provider",
  });
  return readFixture(name).flatMap((record) => {
    const result = adapter.handle(record);
    expect(result.effects).toEqual([]);
    return result.events;
  });
}

function rekeyedEvents(events: readonly Event[]): MessageRekeyedEvent[] {
  return events.filter(
    (event): event is MessageRekeyedEvent => event.type === "message.rekeyed",
  );
}

describe("createLiveAdapter", () => {
  it("emits one durable rekey per persisted text-turn message and no removal", () => {
    const records = readFixture("text-turn");
    const events = replay("text-turn");
    const persistedMessageCount = records.filter(
      (record) => record["type"] === "entry_appended",
    ).length;
    const rekeys = rekeyedEvents(events);

    expect(rekeys).toHaveLength(persistedMessageCount);
    expect(events.some((event) => event.type === "message.removed")).toBe(
      false,
    );
    expect(rekeys[0]).toMatchObject({
      properties: {
        sessionID: OPTIONS.sessionId,
        fromMessageID: expect.stringMatching(/^omo_live_/),
        toMessageID: "omo_entry-text-assistant-1",
        info: {
          id: "omo_entry-text-assistant-1",
          parentID: "omo_entry-text-user-1",
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          tokens: { input: 12, output: 2 },
        },
        parts: [{ type: "text", text: "pong" }],
      },
    });
    expect(
      rekeys.every((event) =>
        isMessageWithParts({
          info: event.properties.info,
          parts: event.properties.parts,
        }),
      ),
    ).toBe(true);
  });

  it("keeps reasoning before text in the authoritative thinking snapshot", () => {
    const rekey = rekeyedEvents(replay("thinking"))[0];

    expect(rekey?.properties.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
    ]);
    expect(rekey?.properties.parts).toMatchObject([
      { type: "reasoning", text: "The requested token is pong." },
      { type: "text", text: "pong" },
    ]);
  });

  it("maps tool-call start and end snapshots through the canonical tool shape", () => {
    const events = replay("tool-call");
    const toolUpdates = events.filter(
      (event) =>
        event.type === "message.part.updated" &&
        event.properties.part.type === "tool",
    );

    expect(toolUpdates).toHaveLength(4);
    expect(toolUpdates[0]).toMatchObject({
      properties: {
        part: {
          id: "omo_call-read-1",
          tool: "read",
          state: { status: "pending", input: {} },
        },
      },
    });
    expect(toolUpdates[1]).toMatchObject({
      properties: {
        part: {
          state: {
            status: "pending",
            input: { path: "/TMP/hello.txt" },
          },
        },
      },
    });
  });

  it("strips skill prefixes and supports finalization without a provisional id", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.seed({
      lastKnownModel: "gpt-seeded",
      lastKnownProvider: "provider-seeded",
    });
    const userStart = adapter.handle({
      type: "message_start",
      message: {
        role: "user",
        content: "$frontend inspect this",
        timestamp: 1_000,
      },
    });
    const userRekey = adapter.handle({
      type: "entry_appended",
      timestamp: "1970-01-01T00:00:01.000Z",
      entry: {
        id: "user-1",
        parentId: null,
        message: {
          role: "user",
          content: "$frontend inspect this",
          timestamp: 1_000,
        },
      },
    });
    const assistantRekey = adapter.handle({
      type: "entry_appended",
      timestamp: "1970-01-01T00:00:02.000Z",
      entry: {
        id: "assistant-1",
        parentId: "user-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          timestamp: 2_000,
        },
      },
    });

    expect(userStart.events).toMatchObject([
      {
        type: "message.updated",
        properties: {
          info: {
            role: "user",
            agent: "skill:frontend",
            metadata: { omoSkill: "frontend" },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: { part: { type: "text", text: "inspect this" } },
      },
    ]);
    expect(rekeyedEvents(userRekey.events)[0]).toMatchObject({
      properties: {
        toMessageID: "omo_user-1",
        info: { agent: "skill:frontend" },
        parts: [{ text: "inspect this" }],
      },
    });
    expect(rekeyedEvents(assistantRekey.events)[0]).toMatchObject({
      properties: {
        fromMessageID: "omo_assistant-1",
        toMessageID: "omo_assistant-1",
        info: {
          parentID: "omo_user-1",
          modelID: "gpt-seeded",
          providerID: "provider-seeded",
        },
      },
    });
  });
});
