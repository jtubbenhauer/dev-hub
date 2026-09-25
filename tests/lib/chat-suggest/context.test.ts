import { describe, it, expect } from "vitest";
import {
  buildSuggestionContext,
  stripInjectedContext,
} from "@/lib/chat-suggest/context";
import type { MessageWithParts } from "@/lib/opencode/types";

function makeMessage(
  id: string,
  role: "user" | "assistant",
  texts: string[],
  options: { synthetic?: boolean } = {},
): MessageWithParts {
  return {
    info: { id, role, sessionID: "s1" },
    parts: texts.map((text, index) => ({
      id: `${id}-p${index}`,
      sessionID: "s1",
      messageID: id,
      type: "text",
      text,
      synthetic: options.synthetic,
    })),
  } as unknown as MessageWithParts;
}

describe("buildSuggestionContext", () => {
  it("returns null when the last message is from the user", () => {
    const messages = [
      makeMessage("a1", "assistant", ["Done."]),
      makeMessage("u1", "user", ["thanks"]),
    ];
    expect(buildSuggestionContext(messages)).toBeNull();
  });

  it("returns null for an empty conversation", () => {
    expect(buildSuggestionContext([])).toBeNull();
  });

  it("uses the latest assistant message with text in the final agent turn", () => {
    const messages = [
      makeMessage("u1", "user", ["fix the sweep"]),
      makeMessage("a1", "assistant", ["Recommended next steps: A15 first."]),
      makeMessage("a2", "assistant", []),
    ];
    const context = buildSuggestionContext(messages);
    expect(context?.lastAgentMessageId).toBe("a1");
    expect(context?.lastAgentMessage).toBe(
      "Recommended next steps: A15 first.",
    );
  });

  it("does not reach past a user message for agent text", () => {
    const messages = [
      makeMessage("a0", "assistant", ["old reply"]),
      makeMessage("u1", "user", ["go"]),
      makeMessage("a1", "assistant", []),
    ];
    expect(buildSuggestionContext(messages)).toBeNull();
  });

  it("collects recent user messages, skipping slash commands, synthetic parts and PR context", () => {
    const messages = [
      makeMessage("u1", "user", ["/compact"]),
      makeMessage("u2", "user", ["ok cool, ship it"]),
      makeMessage("u3", "user", ["injected"], { synthetic: true }),
      makeMessage("u4", "user", ["PR #12: Title\nStatus: open\n\nreview it"]),
      makeMessage("u5", "user", [
        "Context files: a.ts, b.ts\n\nwhy is this failing?",
      ]),
      makeMessage("a1", "assistant", ["Here is why."]),
    ];
    expect(buildSuggestionContext(messages)?.recentUserMessages).toEqual([
      "ok cool, ship it",
      "why is this failing?",
    ]);
  });

  it("keeps the tail of very long agent messages", () => {
    const longText = "x".repeat(7000) + "END";
    const context = buildSuggestionContext([
      makeMessage("a1", "assistant", [longText]),
    ]);
    expect(context?.lastAgentMessage.endsWith("END")).toBe(true);
    expect(context?.lastAgentMessage.length).toBeLessThan(longText.length);
  });
});

describe("stripInjectedContext", () => {
  it("removes comment and file context blocks", () => {
    const text =
      'Comment references:\n- [comment:1] a.ts:3 — "hm"\n\nContext files: a.ts\n\nplease fix';
    expect(stripInjectedContext(text)).toBe("please fix");
  });
});
