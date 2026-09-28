import { describe, expect, it } from "vitest";
import {
  agentTaskDescription,
  childSessionIdsForAgentPart,
} from "@/lib/chat/agent-task-summary";

describe("agentTaskDescription", () => {
  it("uses the OpenCode description first", () => {
    expect(agentTaskDescription({ description: "Find auth" })).toBe(
      "Find auth",
    );
  });

  it("uses an OmO task_summary", () => {
    expect(agentTaskDescription({ task_summary: "Read math.ts" })).toBe(
      "Read math.ts",
    );
  });

  it("summarises a parallel OmO call", () => {
    expect(
      agentTaskDescription({
        tasks: [{ description: "first" }, { task_summary: "second" }],
      }),
    ).toBe("2 tasks: first; second");
    expect(agentTaskDescription({ tasks: [{}, {}] })).toBe("2 tasks");
  });

  it("returns undefined when nothing describes the task", () => {
    expect(agentTaskDescription({ prompt: "x" })).toBeUndefined();
  });
});

describe("childSessionIdsForAgentPart", () => {
  it("merges sessionId and sessionIds without duplicates", () => {
    expect(
      childSessionIdsForAgentPart({
        state: { metadata: { sessionId: "a", sessionIds: ["a", "b"] } },
      }),
    ).toEqual(["a", "b"]);
  });

  it("falls back to part-level metadata", () => {
    expect(
      childSessionIdsForAgentPart({
        state: { status: "pending" },
        metadata: { sessionId: "c" },
      }),
    ).toEqual(["c"]);
  });
});
