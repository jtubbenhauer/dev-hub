import { describe, expect, it } from "vitest";
import {
  buildSessionTitleMessages,
  describeSessionLength,
  parseGeneratedTitle,
} from "@/lib/session-title/prompts";

const HOUR_MS = 60 * 60 * 1000;

describe("parseGeneratedTitle", () => {
  it.each([
    ['"Fix login redirect loop."', "Fix login redirect loop"],
    ["Title: Stripe deposit rollout", "Stripe deposit rollout"],
    ["\u201CReview PR #6027\u201D\nextra line", "Review PR #6027"],
    ["\n\n  Plain title  ", "Plain title"],
  ])("cleans %j", (raw, expected) => {
    expect(parseGeneratedTitle(raw)).toBe(expected);
  });

  it("returns null for an empty reply", () => {
    expect(parseGeneratedTitle("  \n ")).toBeNull();
    expect(parseGeneratedTitle('""')).toBeNull();
  });
});

describe("buildSessionTitleMessages", () => {
  it("sends the session length and every sampled developer message", () => {
    const [, user] = buildSessionTitleMessages({
      userTurnCount: 40,
      sessionSpanMs: 60 * HOUR_MS,
      userMessages: ["first ask", "new focus"],
      agentMessages: [],
    });
    expect(user?.content).toContain(
      '<session length="40 developer messages over 2.5 days" />',
    );
    expect(user?.content).toContain("first ask");
    expect(user?.content).toContain("new focus");
    expect(user?.content).not.toContain("agent_recent_messages");
  });

  it("includes the agent's replies when there are any", () => {
    const [, user] = buildSessionTitleMessages({
      userTurnCount: 1,
      sessionSpanMs: 0,
      userMessages: ["first ask"],
      agentMessages: ["Fixed the redirect."],
    });
    expect(user?.content).toContain("Fixed the redirect.");
  });
});

describe("describeSessionLength", () => {
  it.each([
    [1, 0, "1 developer message"],
    [3, null, "3 developer messages"],
    [3, 10 * 60 * 1000, "3 developer messages within an hour"],
    [12, 5 * HOUR_MS, "12 developer messages over 5 hours"],
    [109, 156 * HOUR_MS, "109 developer messages over 6.5 days"],
  ])("describes %i messages over %s ms", (count, spanMs, expected) => {
    expect(describeSessionLength(count, spanMs)).toBe(expected);
  });
});
