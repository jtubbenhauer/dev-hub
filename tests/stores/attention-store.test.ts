import { beforeEach, describe, expect, it } from "vitest";

import {
  attentionKey,
  MAX_UNSEEN_FINISHED,
  useAttentionStore,
} from "@/stores/attention-store";

describe("attention store", () => {
  beforeEach(() => {
    useAttentionStore.setState({ unseenFinishedKeys: [] });
  });

  it("builds keys as workspaceId:sessionId", () => {
    expect(attentionKey("ws1", "s1")).toBe("ws1:s1");
  });

  it("marks a finished session as unseen", () => {
    useAttentionStore.getState().markFinishedUnseen("ws1", "s1");

    expect(useAttentionStore.getState().unseenFinishedKeys).toEqual(["ws1:s1"]);
  });

  it("moves an already-marked key to the end", () => {
    const { markFinishedUnseen } = useAttentionStore.getState();
    markFinishedUnseen("ws1", "s1");
    markFinishedUnseen("ws1", "s2");

    markFinishedUnseen("ws1", "s1");

    expect(useAttentionStore.getState().unseenFinishedKeys).toEqual([
      "ws1:s2",
      "ws1:s1",
    ]);
  });

  it("drops the oldest keys beyond the cap", () => {
    const { markFinishedUnseen } = useAttentionStore.getState();
    for (let index = 0; index < MAX_UNSEEN_FINISHED + 1; index += 1) {
      markFinishedUnseen("ws1", `s${index}`);
    }

    const keys = useAttentionStore.getState().unseenFinishedKeys;
    expect(MAX_UNSEEN_FINISHED).toBe(200);
    expect(keys).toHaveLength(MAX_UNSEEN_FINISHED);
    expect(keys[0]).toBe("ws1:s1");
    expect(keys[keys.length - 1]).toBe(`ws1:s${MAX_UNSEEN_FINISHED}`);
  });

  it("clears a single unseen key", () => {
    const { markFinishedUnseen, clearUnseen } = useAttentionStore.getState();
    markFinishedUnseen("ws1", "s1");
    markFinishedUnseen("ws1", "s2");

    clearUnseen("ws1", "s1");

    expect(useAttentionStore.getState().unseenFinishedKeys).toEqual(["ws1:s2"]);
  });

  it("keeps the same array reference when clearing a missing key", () => {
    useAttentionStore.getState().markFinishedUnseen("ws1", "s1");
    const before = useAttentionStore.getState().unseenFinishedKeys;

    useAttentionStore.getState().clearUnseen("ws1", "missing");

    expect(useAttentionStore.getState().unseenFinishedKeys).toBe(before);
  });

  it("clears every key of one workspace only", () => {
    const { markFinishedUnseen, clearWorkspaceUnseen } =
      useAttentionStore.getState();
    markFinishedUnseen("ws1", "s1");
    markFinishedUnseen("ws10", "s1");
    markFinishedUnseen("ws1", "s2");

    clearWorkspaceUnseen("ws1");

    expect(useAttentionStore.getState().unseenFinishedKeys).toEqual([
      "ws10:s1",
    ]);
  });

  it("keeps the same array reference when the workspace has no keys", () => {
    useAttentionStore.getState().markFinishedUnseen("ws1", "s1");
    const before = useAttentionStore.getState().unseenFinishedKeys;

    useAttentionStore.getState().clearWorkspaceUnseen("other");

    expect(useAttentionStore.getState().unseenFinishedKeys).toBe(before);
  });
});
