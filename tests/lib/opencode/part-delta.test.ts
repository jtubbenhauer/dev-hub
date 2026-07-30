import {
  applyMessagePartDelta,
  PartDeltaBuffer,
  parseMessagePartDelta,
  reconcilePartSnapshot,
  type MessagePartDelta,
} from "@/lib/opencode/part-delta";
import type { Part } from "@/lib/opencode/types";
import { describe, expect, it } from "vitest";

const delta: MessagePartDelta = {
  sessionID: "ses-1",
  messageID: "msg-1",
  partID: "part-1",
  field: "text",
  delta: " world",
};

function textPart(text: string): Part {
  return {
    id: "part-1",
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "text",
    text,
  };
}

function reasoningPart(text: string): Part {
  return {
    id: "part-1",
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "reasoning",
    text,
    time: { start: 1 },
  };
}

describe("message part delta reconciliation", () => {
  it("parses the installed standalone delta event properties", () => {
    expect(parseMessagePartDelta(delta)).toEqual(delta);
  });

  it("rejects malformed delta event properties", () => {
    expect(parseMessagePartDelta({ ...delta, delta: 42 })).toBeNull();
  });

  it("appends text deltas immutably to text parts", () => {
    const original = textPart("hello");

    const updated = applyMessagePartDelta(original, delta);

    expect(updated).toEqual(textPart("hello world"));
    expect(updated).not.toBe(original);
  });

  it("appends text deltas to reasoning parts", () => {
    expect(applyMessagePartDelta(reasoningPart("hello"), delta)).toEqual(
      reasoningPart("hello world"),
    );
  });

  it("rejects unsupported fields and mismatched part identity", () => {
    expect(
      applyMessagePartDelta(textPart("hello"), { ...delta, field: "raw" }),
    ).toBeNull();
    expect(
      applyMessagePartDelta(textPart("hello"), {
        ...delta,
        partID: "other-part",
      }),
    ).toBeNull();
  });

  it("keeps newer live text when a stale snapshot arrives", () => {
    expect(
      reconcilePartSnapshot(
        textPart("hello world"),
        textPart("hello"),
        undefined,
      ),
    ).toEqual(textPart("hello world"));
  });

  it("replays a pre-snapshot delta without duplicating an inclusive snapshot", () => {
    expect(
      reconcilePartSnapshot(undefined, textPart("hello"), " world"),
    ).toEqual(textPart("hello world"));
    expect(
      reconcilePartSnapshot(undefined, textPart("hello world"), " world"),
    ).toEqual(textPart("hello world"));
  });
});

describe("PartDeltaBuffer", () => {
  it("concatenates unknown-part deltas and consumes them once", () => {
    const buffer = new PartDeltaBuffer();

    buffer.add({ ...delta, delta: "hello" });
    buffer.add({ ...delta, delta: " world" });

    expect(buffer.take("ses-1", "msg-1", "part-1")).toBe("hello world");
    expect(buffer.take("ses-1", "msg-1", "part-1")).toBeUndefined();
  });

  it("caps each part and evicts oldest entries at the global bound", () => {
    const buffer = new PartDeltaBuffer(5, 5);

    buffer.add({ ...delta, delta: "123456" });
    buffer.add({ ...delta, partID: "part-2", delta: "x" });

    expect(buffer.take("ses-1", "msg-1", "part-1")).toBeUndefined();
    expect(buffer.take("ses-1", "msg-1", "part-2")).toBe("x");
  });

  it("clears every buffered part owned by a deleted session", () => {
    const buffer = new PartDeltaBuffer();
    buffer.add(delta);
    buffer.add({ ...delta, sessionID: "ses-2", delta: "other" });

    buffer.clearSession("ses-1");

    expect(buffer.take("ses-1", "msg-1", "part-1")).toBeUndefined();
    expect(buffer.take("ses-2", "msg-1", "part-1")).toBe("other");
  });
});
