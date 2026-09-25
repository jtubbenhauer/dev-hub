import { describe, it, expect } from "vitest";
import {
  findCandidateRemainder,
  getLiveCompletionRemainder,
  getNextWordChunk,
} from "@/lib/chat-suggest/match";

describe("findCandidateRemainder", () => {
  const candidates = [
    "Ok great. Let's do the recommended next steps.",
    "Can you explain C3?",
  ];

  it("completes a case-insensitive prefix of the first matching candidate", () => {
    expect(findCandidateRemainder("ok", candidates)).toBe(
      " great. Let's do the recommended next steps.",
    );
  });

  it("returns null for empty input or no match", () => {
    expect(findCandidateRemainder("", candidates)).toBeNull();
    expect(findCandidateRemainder("   ", candidates)).toBeNull();
    expect(findCandidateRemainder("The model", candidates)).toBeNull();
  });

  it("returns null when the typed text already equals the candidate", () => {
    expect(findCandidateRemainder("Can you explain C3?", candidates)).toBe(
      null,
    );
  });
});

describe("getLiveCompletionRemainder", () => {
  const liveCompletion = {
    typedText: "The model mis",
    completion: "readings should be done first",
  };

  it("returns the remainder while the user types through the completion", () => {
    expect(getLiveCompletionRemainder("The model mis", liveCompletion)).toBe(
      "readings should be done first",
    );
    expect(
      getLiveCompletionRemainder("The model misread", liveCompletion),
    ).toBe("ings should be done first");
  });

  it("returns null once the user diverges or deletes back past the request", () => {
    expect(
      getLiveCompletionRemainder("The model misx", liveCompletion),
    ).toBeNull();
    expect(getLiveCompletionRemainder("The model", liveCompletion)).toBeNull();
    expect(getLiveCompletionRemainder("The model mis", null)).toBeNull();
  });
});

describe("getNextWordChunk", () => {
  it("takes the next word with surrounding whitespace", () => {
    expect(getNextWordChunk(" great. Let's go")).toBe(" great. ");
    expect(getNextWordChunk("readings should")).toBe("readings ");
    expect(getNextWordChunk("end")).toBe("end");
  });
});
