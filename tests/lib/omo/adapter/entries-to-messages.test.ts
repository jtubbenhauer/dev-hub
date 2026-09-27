// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  entriesToMessages,
  windowMessages,
} from "@/lib/omo/adapter/entries-to-messages";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import {
  fixtureEntries,
  fixtureNames,
  messageEntry,
  OPTIONS,
  scenarioEntries,
} from "@/tests/lib/omo/adapter/entries-to-messages-fixtures";

describe("entriesToMessages", () => {
  it("produces valid SDK messages from every committed RPC fixture projection", () => {
    const shapes: Record<string, unknown> = {};

    for (const fixtureName of fixtureNames()) {
      const entries = fixtureEntries(fixtureName);
      const messages = entriesToMessages(entries, OPTIONS);
      expect(messages.every(isMessageWithParts), fixtureName).toBe(true);
      const userEntries = entries.filter(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
      const userMessages = messages.filter(
        (message) => message.info.role === "user",
      );
      userMessages.forEach((message, index) => {
        expect(message.info.time.created).toBeGreaterThanOrEqual(
          userEntries[index]?.timestamp ?? 0,
        );
      });
      shapes[fixtureName] = messages.map((message) => ({
        role: message.info.role,
        parts: message.parts.map((part) => part.type),
      }));
    }

    expect(shapes).toMatchInlineSnapshot(`
      {
        "abort.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
        ],
        "catalog.jsonl": [],
        "compaction.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "assistant",
          },
        ],
        "lifecycle.jsonl": [],
        "question.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
        ],
        "task-subagent.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
        ],
        "text-turn.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
          {
            "parts": [
              "text",
            ],
            "role": "assistant",
          },
        ],
        "thinking.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
          {
            "parts": [
              "reasoning",
              "text",
            ],
            "role": "assistant",
          },
        ],
        "tool-call.jsonl": [
          {
            "parts": [
              "text",
            ],
            "role": "user",
          },
          {
            "parts": [
              "tool",
            ],
            "role": "assistant",
          },
        ],
      }
    `);
  });

  it("maps content, metadata entries, skill prefixes, and folded tool results", () => {
    const messages = entriesToMessages(scenarioEntries(), OPTIONS);

    expect(messages).toHaveLength(7);
    expect(messages.every(isMessageWithParts)).toBe(true);
    expect(messages[0]).toMatchObject({
      info: { agent: "skill:frontend", metadata: { omoSkill: "frontend" } },
      parts: [
        { type: "text", text: "inspect this" },
        { type: "file", url: "data:image/png;base64,aGVsbG8=" },
      ],
    });
    expect(messages[1]).toMatchObject({
      info: { parentID: "omo_user-1", cost: 0.5 },
      parts: [
        { type: "reasoning" },
        { type: "text" },
        {
          type: "tool",
          state: {
            status: "completed",
            output: "done",
            metadata: { child_session_id: "child-1", sessionId: "omo_child-1" },
          },
        },
        { type: "file", url: "data:image/jpeg;base64,aW1hZ2U=" },
      ],
    });
    expect(messages[2]).toMatchObject({
      info: { metadata: { compaction: true } },
      parts: [{ text: "[compaction] summary" }],
    });
    expect(messages.slice(3).map((message) => message.parts[0])).toMatchObject([
      { metadata: { omoSource: "branch_summary" } },
      { metadata: { omoSource: "custom" } },
      { metadata: { omoSource: "custom_message" } },
      { metadata: { omoSource: "bashExecution" } },
    ]);
  });

  it("returns the preceding oldest-first window anchored before an id", () => {
    const entries = [1, 2, 3, 4].map((number) =>
      messageEntry({
        id: `user-${number}`,
        parentId: null,
        timestamp: number,
        message: {
          role: "user",
          content: String(number),
          timestamp: number,
        },
      }),
    );
    const messages = entriesToMessages(entries, OPTIONS);

    expect(
      windowMessages(messages, { limit: 2, before: "omo_user-4" }).map(
        (message) => message.info.id,
      ),
    ).toEqual(["omo_user-2", "omo_user-3"]);
    expect(
      windowMessages(messages, { limit: 2 }).map((message) => message.info.id),
    ).toEqual(["omo_user-3", "omo_user-4"]);
  });
});
