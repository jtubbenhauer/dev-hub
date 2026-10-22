import { describe, expect, it } from "vitest";
import {
  buildSessionTitleContext,
  developerTextOf,
} from "@/lib/session-title/context";
import type { MessageWithParts } from "@/lib/opencode/types";

const HOUR_MS = 60 * 60 * 1000;

function message(
  role: "user" | "assistant",
  text: string,
  options: { readonly synthetic?: boolean; readonly createdAt?: number } = {},
): MessageWithParts {
  return {
    info: {
      id: `${role}-${text.slice(0, 20)}`,
      role,
      sessionID: "s1",
      time: { created: options.createdAt },
    },
    parts: [{ type: "text", text, synthetic: options.synthetic }],
  } as unknown as MessageWithParts;
}

const SKILL_INVOCATION = [
  'The user explicitly invoked the "ulw-execute" skill. Follow the instructions in <skill-instruction> as binding for this request.',
  "",
  '<skill-instruction name="ulw-execute">\n# ulw-execute\nRun the plan.\n</skill-instruction>',
  "",
  "<user-request>\nstripe-direct-charges --make-pr Can you do this in a worktree\n</user-request>",
].join("\n");

const ANSWERED_QUESTION = [
  "[Answer to question toolu_1]",
  "Staging: (see [The user's answer to Staging for question toolu_1] below)",
  "[The user's answer to Staging for question toolu_1]",
  "We're not blocking tonight's release on this change.",
].join("\n");

const UNANSWERED_QUESTION =
  "[Answer to question toolu_2]\nThe user did not answer within 30 minutes. Continue the work on your best judgment.";

const WITH_PLAN_REMINDER =
  "I need the same CLI steps we ran on staging.\n\n<omo-senpi-ulw-execute>\nAn active ulw-execute work plan is present.\n</omo-senpi-ulw-execute>";

describe("developerTextOf", () => {
  it("keeps only the request from a skill invocation", () => {
    expect(developerTextOf(SKILL_INVOCATION)).toBe(
      "stripe-direct-charges --make-pr Can you do this in a worktree",
    );
  });

  it("keeps the answer from a question reply without its labels", () => {
    const text = developerTextOf(ANSWERED_QUESTION);
    expect(text).toContain("We're not blocking tonight's release");
    expect(text).not.toContain("toolu_1");
  });

  it("drops unanswered question stubs and injected plan reminders", () => {
    expect(developerTextOf(UNANSWERED_QUESTION)).toBe("");
    expect(developerTextOf(WITH_PLAN_REMINDER)).toBe(
      "I need the same CLI steps we ran on staging.",
    );
  });
});

describe("buildSessionTitleContext", () => {
  it("titles a long chat from its real work, not its noise", () => {
    const context = buildSessionTitleContext([
      message("user", SKILL_INVOCATION),
      message("user", ANSWERED_QUESTION),
      message("user", WITH_PLAN_REMINDER),
      message("user", UNANSWERED_QUESTION),
      message("user", "Continue"),
      message(
        "user",
        "1. The webhook: let's do as recommended. 2. Push the fix onto #6405, it's not merged yet.",
      ),
      message("user", "approve"),
      message("user", "I still don't see any PR comments on #6405?"),
      message("user", "What time is it in UTC now?"),
      message("assistant", "Posted the review comments on #6405."),
      message("assistant", "It is 06:28 UTC."),
    ]);

    expect(context?.userTurnCount).toBe(8);
    expect(context?.userMessages[0]).toBe(
      "stripe-direct-charges --make-pr Can you do this in a worktree",
    );
    expect(context?.userMessages).not.toContain("Continue");
    expect(context?.userMessages).not.toContain("approve");
    expect(context?.userMessages.join("\n")).not.toMatch(
      /did not answer|skill-instruction|omo-senpi/,
    );
    expect(context?.agentMessages).toEqual([
      "Posted the review comments on #6405.",
      "It is 06:28 UTC.",
    ]);
  });

  it("covers a long session evenly and leaves out the agent's latest replies", () => {
    const messages = [
      ...Array.from({ length: 60 }, (_, index) =>
        message("user", `topic ${index} of the Ask intent work`, {
          createdAt: index * HOUR_MS,
        }),
      ),
      message("assistant", "Deployed the latest build to dev."),
    ];

    const context = buildSessionTitleContext(messages);
    const pickedIndexes = context?.userMessages.map((text) =>
      Number(text.split(" ")[1]),
    );

    expect(context?.userTurnCount).toBe(60);
    expect(context?.sessionSpanMs).toBe(59 * HOUR_MS);
    expect(pickedIndexes).toHaveLength(12);
    expect(pickedIndexes?.[0]).toBeLessThan(7);
    expect(pickedIndexes?.slice(-3)).toEqual([57, 58, 59]);
    expect(context?.agentMessages).toEqual([]);
  });

  it("keeps a short session's sample at seven, spread from first to latest", () => {
    const detailCounts = [2, 2, 5, 2, 8, 6, 2, 2, 2, 2];
    const messages = detailCounts.map((count, index) =>
      message("user", `topic ${index} ${"detail ".repeat(count)}`.trim()),
    );

    const picked = buildSessionTitleContext(messages)?.userMessages.map(
      (text) => text.split(" ").slice(0, 2).join(" "),
    );

    expect(picked).toEqual([
      "topic 0",
      "topic 2",
      "topic 4",
      "topic 5",
      "topic 7",
      "topic 8",
      "topic 9",
    ]);
  });

  it("keeps both ends of a very long message", () => {
    const long = `HEAD ${"x".repeat(2000)} TAIL`;
    const [excerpt] = buildSessionTitleContext([message("user", long)])
      ?.userMessages ?? [""];
    expect(excerpt?.startsWith("HEAD")).toBe(true);
    expect(excerpt?.endsWith("TAIL")).toBe(true);
    expect(excerpt?.length).toBeLessThanOrEqual(503);
  });

  it("ignores synthetic parts and returns null before the user has said anything", () => {
    expect(
      buildSessionTitleContext([
        message("assistant", "hi"),
        message("user", "attached", { synthetic: true }),
      ]),
    ).toBeNull();
  });
});
