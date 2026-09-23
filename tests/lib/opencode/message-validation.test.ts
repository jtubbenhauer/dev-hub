import { describe, expect, it } from "vitest";
import { isMessageWithParts } from "@/lib/opencode/message-validation";

interface MessageFixture {
  info: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
}

function validMessage(): MessageFixture {
  return {
    info: {
      id: "message-1",
      sessionID: "session-1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "hello",
      },
    ],
  };
}

describe("isMessageWithParts", () => {
  it("accepts a structurally complete message", () => {
    expect(isMessageWithParts(validMessage())).toBe(true);
  });

  it("rejects an unknown message role", () => {
    const value = validMessage();
    value.info.role = "unknown";

    expect(isMessageWithParts(value)).toBe(false);
  });

  it("rejects a text part without text", () => {
    const value = validMessage();
    const { text: _text, ...malformedPart } = value.parts[0];
    value.parts = [malformedPart];

    expect(isMessageWithParts(value)).toBe(false);
  });

  it("rejects a tool part without state", () => {
    const value = validMessage();
    value.parts = [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-1",
        tool: "read",
      },
    ];

    expect(isMessageWithParts(value)).toBe(false);
  });

  it("rejects a completed tool state without output", () => {
    const value = validMessage();
    value.parts = [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-1",
        tool: "read",
        state: {
          status: "completed",
          input: {},
          title: "read",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ];

    expect(isMessageWithParts(value)).toBe(false);
  });

  it("rejects parts belonging to a different message", () => {
    const value = validMessage();
    value.parts[0].messageID = "message-2";

    expect(isMessageWithParts(value)).toBe(false);
  });
});
