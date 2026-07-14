import { describe, it, expect } from "vitest";
import {
  mergeTailWindow,
  mergePrependWindow,
  mergeFullMessage,
} from "@/lib/opencode/merge-messages";
import { TRUNCATION_MARKER_KEY } from "@/lib/opencode/truncate-messages";
import type { Message, MessageWithParts, Part } from "@/lib/opencode/types";

function toolPart(id: string, output: string, truncated = false): Part {
  return {
    id,
    sessionID: "ses-1",
    messageID: "m",
    type: "tool",
    callID: `c-${id}`,
    tool: "read",
    state: {
      status: "completed",
      input: {},
      output,
      title: "t",
      metadata: {},
      time: { start: 1, end: 2 },
    },
    ...(truncated
      ? { metadata: { [TRUNCATION_MARKER_KEY]: { output: 99_999 } } }
      : {}),
  } as Part;
}

function msg(id: string, parts: Part[] = []): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "ses-1",
      role: "assistant",
      time: { created: 1 },
    } as unknown as Message,
    parts,
  };
}

describe("mergeTailWindow", () => {
  it("returns the incoming window when nothing is loaded yet", () => {
    const incoming = [msg("a"), msg("b")];
    expect(mergeTailWindow([], incoming)).toBe(incoming);
  });

  it("preserves older prefix and live SSE suffix around the overlap", () => {
    const existing = [msg("a"), msg("b"), msg("c"), msg("d"), msg("e")];
    const incoming = [msg("c"), msg("d")];

    const result = mergeTailWindow(existing, incoming).map((m) => m.info.id);
    expect(result).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("adds newer messages contained in the window", () => {
    const existing = [msg("a"), msg("b"), msg("c")];
    const incoming = [msg("b"), msg("c"), msg("d")];

    const result = mergeTailWindow(existing, incoming).map((m) => m.info.id);
    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  it("appends a disjoint newer window after older history", () => {
    const existing = [msg("a"), msg("b")];
    const incoming = [msg("c"), msg("d")];

    const result = mergeTailWindow(existing, incoming).map((m) => m.info.id);
    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps expanded full tool output when the incoming part is truncated", () => {
    const existing = [msg("m1", [toolPart("p1", "FULL_OUTPUT")])];
    const incoming = [msg("m1", [toolPart("p1", "trunc", true)])];

    const [merged] = mergeTailWindow(existing, incoming);
    const part = merged.parts[0];
    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.output).toBe("FULL_OUTPUT");
  });

  it("takes the incoming (truncated) part when nothing fuller is held", () => {
    const existing = [msg("m1", [toolPart("p1", "old", true)])];
    const incoming = [msg("m1", [toolPart("p1", "new-trunc", true)])];

    const [merged] = mergeTailWindow(existing, incoming);
    const part = merged.parts[0];
    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.output).toBe("new-trunc");
  });
});

describe("mergePrependWindow", () => {
  it("prepends unique older messages and reports the added count", () => {
    const existing = [msg("c"), msg("d")];
    const older = [msg("a"), msg("b")];

    const { messages, addedCount } = mergePrependWindow(existing, older);
    expect(messages.map((m) => m.info.id)).toEqual(["a", "b", "c", "d"]);
    expect(addedCount).toBe(2);
  });

  it("dedupes overlap and only counts genuinely new messages", () => {
    const existing = [msg("b"), msg("c")];
    const older = [msg("a"), msg("b")];

    const { messages, addedCount } = mergePrependWindow(existing, older);
    expect(messages.map((m) => m.info.id)).toEqual(["a", "b", "c"]);
    expect(addedCount).toBe(1);
  });

  it("returns the existing array by identity when everything is a duplicate", () => {
    const existing = [msg("a"), msg("b")];
    const older = [msg("a")];

    const result = mergePrependWindow(existing, older);
    expect(result.messages).toBe(existing);
    expect(result.addedCount).toBe(0);
  });
});

describe("mergeFullMessage", () => {
  it("replaces a truncated message's parts with the full version in place", () => {
    const existing = [
      msg("m1", [toolPart("p1", "trunc", true)]),
      msg("m2", [toolPart("p2", "other")]),
    ];
    const full = msg("m1", [toolPart("p1", "THE_FULL_OUTPUT")]);

    const result = mergeFullMessage(existing, full);
    const part = result[0].parts[0];
    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.output).toBe("THE_FULL_OUTPUT");
    expect(result[1]).toBe(existing[1]);
  });

  it("returns existing unchanged when the message is not loaded", () => {
    const existing = [msg("m1")];
    const result = mergeFullMessage(existing, msg("zzz"));
    expect(result).toBe(existing);
  });
});
