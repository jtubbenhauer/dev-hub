import { describe, expect, it } from "vitest";
import { getQueuedUserMessageIds } from "@/lib/chat/queued-messages";
import type { MessageWithParts } from "@/lib/opencode/types";

function userMessage(id: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "sess-1",
      role: "user",
      time: { created: 1 },
      agent: "",
      model: { providerID: "", modelID: "" },
    },
    parts: [],
  };
}

function assistantMessage(id: string, isCompleted: boolean): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "sess-1",
      role: "assistant",
      time: isCompleted ? { created: 1, completed: 2 } : { created: 1 },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [],
  };
}

describe("getQueuedUserMessageIds", () => {
  it("marks user messages sent after the in-progress assistant message as queued", () => {
    const queued = getQueuedUserMessageIds([
      userMessage("u1"),
      assistantMessage("a1", false),
      userMessage("u2"),
      userMessage("optimistic-3"),
    ]);

    expect([...queued]).toEqual(["u2", "optimistic-3"]);
  });

  it("does not queue the user message the agent is currently answering", () => {
    const queued = getQueuedUserMessageIds([
      userMessage("u1"),
      assistantMessage("a1", false),
    ]);

    expect(queued.size).toBe(0);
  });

  it("returns nothing when the latest assistant message has completed", () => {
    const queued = getQueuedUserMessageIds([
      userMessage("u1"),
      assistantMessage("a1", true),
      userMessage("u2"),
    ]);

    expect(queued.size).toBe(0);
  });

  it("ignores earlier incomplete assistant messages", () => {
    const queued = getQueuedUserMessageIds([
      assistantMessage("a0", false),
      userMessage("u1"),
      assistantMessage("a1", true),
      userMessage("u2"),
    ]);

    expect(queued.size).toBe(0);
  });
});
