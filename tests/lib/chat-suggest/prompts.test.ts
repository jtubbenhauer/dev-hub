import { describe, it, expect } from "vitest";
import {
  buildLiveCompletionMessages,
  buildReplySuggestionMessages,
  extractCompletionFromFullMessage,
  parseReplySuggestions,
} from "@/lib/chat-suggest/prompts";

const promptInput = {
  lastAgentMessage: "Recommended next steps: tool data first.",
  recentUserMessages: ["ok cool", "ship it"],
};

describe("buildReplySuggestionMessages", () => {
  it("includes the agent message and the user's previous messages", () => {
    const [system, user] = buildReplySuggestionMessages(promptInput);
    expect(system.role).toBe("system");
    expect(user.content).toContain("Recommended next steps: tool data first.");
    expect(user.content).toContain("ok cool");
    expect(user.content).toContain("ship it");
  });
});

describe("buildLiveCompletionMessages", () => {
  it("includes the typed text", () => {
    const [, user] = buildLiveCompletionMessages({
      ...promptInput,
      typedText: "The model mis",
    });
    expect(user.content).toContain(
      "<typed_so_far>The model mis</typed_so_far>",
    );
  });
});

describe("parseReplySuggestions", () => {
  it("parses a JSON array, even when wrapped in prose or code fences", () => {
    expect(
      parseReplySuggestions('```json\n["Ok great, go ahead", "Why A15?"]\n```'),
    ).toEqual(["Ok great, go ahead", "Why A15?"]);
  });

  it("drops non-strings, blanks and duplicates, and caps the count", () => {
    expect(
      parseReplySuggestions('["a", "a", "", 3, "b", "c", "d", "e", "f"]'),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns an empty list for malformed output", () => {
    expect(parseReplySuggestions("no json here")).toEqual([]);
    expect(parseReplySuggestions("[not json]")).toEqual([]);
  });
});

describe("extractCompletionFromFullMessage", () => {
  it("returns the text after the typed prefix, preserving mid-word continuation", () => {
    expect(
      extractCompletionFromFullMessage(
        "The model mis",
        "The model misreadings should be done first.",
      ),
    ).toBe("readings should be done first.");
  });

  it("preserves the space when the typed text ends a word", () => {
    expect(
      extractCompletionFromFullMessage("Ok", "Ok sounds good, go ahead."),
    ).toBe(" sounds good, go ahead.");
  });

  it("matches the prefix case-insensitively and strips quotes and extra lines", () => {
    expect(
      extractCompletionFromFullMessage("ok", '"Ok great."\nSecond line'),
    ).toBe(" great.");
  });

  it("returns an empty string when the model rewrote the typed text", () => {
    expect(
      extractCompletionFromFullMessage("Actually can we", "Can we instead…"),
    ).toBe("");
  });
});
