import {
  formatDescendantActivity,
  getDescendantActivity,
} from "@/lib/chat/descendant-activity";
import type { Session } from "@/lib/opencode/types";
import { describe, expect, it } from "vitest";

function session(
  id: string,
  parentID: string | undefined,
  updated: number,
): Session {
  return {
    id,
    parentID,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "1",
    time: { created: updated, updated },
  };
}

const baseOptions = {
  parentSessionId: "parent",
  sessions: {
    parent: session("parent", undefined, 1_000),
    child: session("child", "parent", 1_000),
    grandchild: session("grandchild", "child", 1_000),
    unrelated: session("unrelated", undefined, 1_000),
  },
  permissions: [],
  questions: [],
  now: 2_000,
  recentWindowMs: 500,
} as const;

describe("getDescendantActivity", () => {
  it("counts active descendants recursively without including unrelated sessions", () => {
    const activity = getDescendantActivity({
      ...baseOptions,
      statuses: {
        child: { type: "busy" },
        grandchild: { type: "retry", attempt: 1, message: "", next: 3_000 },
        unrelated: { type: "busy" },
      },
    });

    expect(activity).toEqual({
      activeCount: 2,
      waitingCount: 0,
      recentCount: 0,
    });
  });

  it("gives waiting-for-user precedence over an active status", () => {
    const activity = getDescendantActivity({
      ...baseOptions,
      statuses: { child: { type: "busy" } },
      questions: [
        {
          id: "question",
          sessionID: "child",
          questions: [],
        },
      ],
    });

    expect(activity).toEqual({
      activeCount: 0,
      waitingCount: 1,
      recentCount: 0,
    });
  });

  it("counts only recently updated idle descendants as recent", () => {
    const activity = getDescendantActivity({
      ...baseOptions,
      sessions: {
        parent: session("parent", undefined, 2_000),
        recent: session("recent", "parent", 1_750),
        stale: session("stale", "parent", 1_000),
      },
      statuses: {
        recent: { type: "idle" },
        stale: { type: "idle" },
      },
    });

    expect(activity).toEqual({
      activeCount: 0,
      waitingCount: 0,
      recentCount: 1,
    });
  });
});

describe("formatDescendantActivity", () => {
  it("prioritizes waiting descendants over active descendants", () => {
    expect(
      formatDescendantActivity({
        activeCount: 2,
        waitingCount: 1,
        recentCount: 3,
      }),
    ).toBe("1 subagent waiting for input");
  });

  it("formats the active descendant count", () => {
    expect(
      formatDescendantActivity({
        activeCount: 2,
        waitingCount: 0,
        recentCount: 0,
      }),
    ).toBe("2 subagents working");
  });
});
