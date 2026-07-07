import { describe, it, expect } from "vitest";
import {
  computeFirstUserMessageIndex,
  computeLastUserMessageIndex,
  computeNextUserMessageIndex,
  computePrevUserMessageIndex,
} from "@/lib/chat-navigation";
import type { MessageWithParts } from "@/lib/opencode/types";

function makeMsg(id: string, role: "user" | "assistant"): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "s1",
      role,
      time: { created: 1 },
      agent: "",
      model: { providerID: "", modelID: "" },
      // Assistant messages need extra fields for the union type, but the
      // navigation helpers only touch `role`, so the cast is safe here.
    } as MessageWithParts["info"],
    parts: [],
  };
}

const U = (id: string) => makeMsg(id, "user");
const A = (id: string) => makeMsg(id, "assistant");

describe("chat-navigation", () => {
  describe("computeNextUserMessageIndex", () => {
    it("returns null for an empty list", () => {
      expect(computeNextUserMessageIndex([], 0)).toBeNull();
    });

    it("returns null when there are no user messages", () => {
      const msgs = [A("a1"), A("a2"), A("a3")];
      expect(computeNextUserMessageIndex(msgs, -1)).toBeNull();
    });

    it("finds the first user message when anchor is before the start", () => {
      const msgs = [A("a1"), U("u1"), A("a2"), U("u2")];
      expect(computeNextUserMessageIndex(msgs, -1)).toBe(1);
    });

    it("advances past the anchor even when it lands on a user message", () => {
      const msgs = [U("u1"), A("a1"), U("u2"), A("a2"), U("u3")];
      expect(computeNextUserMessageIndex(msgs, 0)).toBe(2);
      expect(computeNextUserMessageIndex(msgs, 2)).toBe(4);
    });

    it("returns null once the anchor is past the last user message", () => {
      const msgs = [U("u1"), A("a1"), U("u2"), A("a2")];
      expect(computeNextUserMessageIndex(msgs, 2)).toBeNull();
      expect(computeNextUserMessageIndex(msgs, 3)).toBeNull();
      expect(computeNextUserMessageIndex(msgs, 999)).toBeNull();
    });

    it("clamps negative anchors to 'before start'", () => {
      const msgs = [U("u1"), A("a1")];
      expect(computeNextUserMessageIndex(msgs, -100)).toBe(0);
    });
  });

  describe("computePrevUserMessageIndex", () => {
    it("returns null for an empty list", () => {
      expect(computePrevUserMessageIndex([], 5)).toBeNull();
    });

    it("returns null when there are no user messages", () => {
      const msgs = [A("a1"), A("a2")];
      expect(computePrevUserMessageIndex(msgs, 1)).toBeNull();
    });

    it("finds the last user message when anchor is past the end", () => {
      const msgs = [U("u1"), A("a1"), U("u2"), A("a2")];
      expect(computePrevUserMessageIndex(msgs, msgs.length)).toBe(2);
      expect(computePrevUserMessageIndex(msgs, 999)).toBe(2);
    });

    it("retreats past the anchor even when it lands on a user message", () => {
      const msgs = [U("u1"), A("a1"), U("u2"), A("a2"), U("u3")];
      expect(computePrevUserMessageIndex(msgs, 4)).toBe(2);
      expect(computePrevUserMessageIndex(msgs, 2)).toBe(0);
    });

    it("returns null once anchor is before the first user message", () => {
      const msgs = [A("a1"), U("u1"), A("a2")];
      expect(computePrevUserMessageIndex(msgs, 1)).toBeNull();
      expect(computePrevUserMessageIndex(msgs, 0)).toBeNull();
    });
  });

  describe("computeFirstUserMessageIndex", () => {
    it("returns null for an empty list", () => {
      expect(computeFirstUserMessageIndex([])).toBeNull();
    });

    it("returns null when there are no user messages", () => {
      expect(computeFirstUserMessageIndex([A("a1"), A("a2")])).toBeNull();
    });

    it("finds the first user message index", () => {
      const msgs = [A("a1"), A("a2"), U("u1"), A("a3"), U("u2")];
      expect(computeFirstUserMessageIndex(msgs)).toBe(2);
    });

    it("returns 0 when the very first message is from the user", () => {
      const msgs = [U("u1"), A("a1")];
      expect(computeFirstUserMessageIndex(msgs)).toBe(0);
    });
  });

  describe("computeLastUserMessageIndex", () => {
    it("returns null for an empty list", () => {
      expect(computeLastUserMessageIndex([])).toBeNull();
    });

    it("returns null when there are no user messages", () => {
      expect(computeLastUserMessageIndex([A("a1"), A("a2")])).toBeNull();
    });

    it("finds the last user message index", () => {
      const msgs = [U("u1"), A("a1"), U("u2"), A("a2"), A("a3")];
      expect(computeLastUserMessageIndex(msgs)).toBe(2);
    });

    it("returns the trailing index when the last message is from the user", () => {
      const msgs = [A("a1"), U("u1"), A("a2"), U("u2")];
      expect(computeLastUserMessageIndex(msgs)).toBe(3);
    });
  });
});
