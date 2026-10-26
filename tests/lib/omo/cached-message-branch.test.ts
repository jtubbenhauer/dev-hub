import { describe, expect, it } from "vitest";
import { dropCachedMessagesOffActiveBranch } from "@/lib/omo/cached-message-branch";
import { mergeTailWindow } from "@/lib/opencode/merge-messages";
import type { MessageWithParts } from "@/lib/opencode/types";

function message(id: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "omo_session",
      role: "assistant",
      time: { created: 0 },
    },
    parts: [],
  } as unknown as MessageWithParts;
}

function ids(messages: readonly MessageWithParts[]): string[] {
  return messages.map((entry) => entry.info.id);
}

describe("dropCachedMessagesOffActiveBranch", () => {
  it("drops cached messages from a branch omo moved away from", () => {
    const cached = ["a", "b", "fork", "dead1", "dead2"].map(message);
    const activeTail = ["b", "fork", "live1", "live2"].map(message);

    expect(ids(dropCachedMessagesOffActiveBranch(cached, activeTail))).toEqual([
      "a",
      "b",
      "fork",
    ]);
  });

  it("keeps the abandoned branch out of the merged tail window", () => {
    const cached = ["a", "b", "fork", "dead1", "dead2"].map(message);
    const activeTail = ["b", "fork", "live1", "live2"].map(message);

    const merged = mergeTailWindow(
      dropCachedMessagesOffActiveBranch(cached, activeTail),
      activeTail,
    );

    expect(ids(merged)).toEqual(["a", "b", "fork", "live1", "live2"]);
  });

  it("repairs a cache that already holds the abandoned branch last", () => {
    const cached = ["a", "fork", "live1", "dead1", "dead2"].map(message);
    const activeTail = ["fork", "live1", "live2"].map(message);

    const merged = mergeTailWindow(
      dropCachedMessagesOffActiveBranch(cached, activeTail),
      activeTail,
    );

    expect(ids(merged)).toEqual(["a", "fork", "live1", "live2"]);
  });

  it("keeps all cached messages when none overlap the tail", () => {
    const cached = ["a", "b"].map(message);
    const activeTail = ["c", "d"].map(message);

    expect(ids(dropCachedMessagesOffActiveBranch(cached, activeTail))).toEqual([
      "a",
      "b",
    ]);
  });
});
