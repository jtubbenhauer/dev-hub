import { describe, expect, it } from "vitest";
import {
  calculateRetentionCutoff,
  planSessionRetention,
} from "@/lib/opencode/retention";

const cutoff = Date.UTC(2026, 4, 17);

function session(
  id: string,
  timeUpdated: number,
  parentId: string | null = null,
) {
  return { id, parentId, timeUpdated, directory: "/workspace", title: id };
}

describe("planSessionRetention", () => {
  it("collapses an entirely old subtree into one OpenCode deletion", () => {
    const plan = planSessionRetention({
      sessions: [
        session("root", cutoff - 3),
        session("child", cutoff - 2, "root"),
        session("grandchild", cutoff - 1, "child"),
      ],
      cutoff,
    });

    expect(plan.deleteSessionIds).toEqual(["root", "child", "grandchild"]);
    expect(plan.deleteRootIds).toEqual(["root"]);
  });

  it("retains every ancestor of a recently used child", () => {
    const plan = planSessionRetention({
      sessions: [
        session("root", cutoff - 3),
        session("recent-child", cutoff + 1, "root"),
        session("old-sibling", cutoff - 1, "root"),
      ],
      cutoff,
    });

    expect(plan.keepSessionIds).toEqual(["recent-child", "root"]);
    expect(plan.deleteSessionIds).toEqual(["old-sibling"]);
    expect(plan.deleteRootIds).toEqual(["old-sibling"]);
  });

  it("retains a session updated exactly at the cutoff", () => {
    const plan = planSessionRetention({
      sessions: [session("boundary", cutoff)],
      cutoff,
    });

    expect(plan.keepSessionIds).toEqual(["boundary"]);
    expect(plan.deleteSessionIds).toEqual([]);
  });

  it("treats a session with a missing parent as a deletion root", () => {
    const plan = planSessionRetention({
      sessions: [session("orphan", cutoff - 1, "missing")],
      cutoff,
    });

    expect(plan.deleteRootIds).toEqual(["orphan"]);
  });

  it("rejects cyclic session graphs", () => {
    expect(() =>
      planSessionRetention({
        sessions: [
          session("a", cutoff - 1, "b"),
          session("b", cutoff - 1, "a"),
        ],
        cutoff,
      }),
    ).toThrow("cycle");
  });

  it("rejects duplicate session IDs", () => {
    expect(() =>
      planSessionRetention({
        sessions: [session("duplicate", 1), session("duplicate", 2)],
        cutoff,
      }),
    ).toThrow("duplicate");
  });
});

describe("calculateRetentionCutoff", () => {
  it("clamps month-end dates to the final day of the target month", () => {
    const now = new Date("2026-05-31T12:34:56.789Z");

    expect(new Date(calculateRetentionCutoff(now, 3)).toISOString()).toBe(
      "2026-02-28T12:34:56.789Z",
    );
  });

  it("handles leap-year February", () => {
    const now = new Date("2024-05-31T00:00:00.000Z");

    expect(new Date(calculateRetentionCutoff(now, 3)).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });
});
