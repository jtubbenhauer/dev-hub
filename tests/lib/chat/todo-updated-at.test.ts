import { describe, expect, it } from "vitest";

import { getTodoUpdatedAt } from "@/lib/chat/todo-updated-at";
import type { MessageWithParts, Session, ToolPart } from "@/lib/opencode/types";

function makeTodoMessage(completedAt: number): MessageWithParts {
  return {
    info: { id: "message-1", role: "assistant" } as MessageWithParts["info"],
    parts: [
      {
        type: "tool",
        tool: "todowrite",
        state: { status: "completed", time: { start: 1, end: completedAt } },
      } as ToolPart,
    ],
  };
}

describe("getTodoUpdatedAt", () => {
  it("uses the latest completed Todo tool timestamp", () => {
    const session = { time: { updated: 300 } } as Session;

    expect(
      getTodoUpdatedAt([makeTodoMessage(100), makeTodoMessage(200)], session),
    ).toBe(200);
  });

  it("falls back to the session update timestamp", () => {
    const session = { time: { updated: 300 } } as Session;

    expect(getTodoUpdatedAt([], session)).toBe(300);
  });
});
