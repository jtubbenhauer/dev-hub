import { describe, expect, it } from "vitest";
import {
  FAVICON_BLINK_INTERVAL_MS,
  TAB_ATTENTION_DOT_COLORS,
  resolveTabAttention,
  selectChatAttention,
  type AttentionWorkspaceSlice,
  type ChatAttention,
  type TabAttention,
} from "@/lib/attention/tab-attention";
import type {
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
} from "@/lib/opencode/types";

const BUSY: SessionStatus = { type: "busy" };
const IDLE: SessionStatus = { type: "idle" };
const RETRY: SessionStatus = {
  type: "retry",
  attempt: 1,
  message: "rate limited",
  next: 1000,
};

function makePermission(id: string): PermissionRequest {
  return {
    id,
    sessionID: "sess-1",
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
  };
}

function makeQuestion(id: string): QuestionRequest {
  return { id, sessionID: "sess-1", questions: [] };
}

function makeSlice(
  overrides: Partial<AttentionWorkspaceSlice> = {},
): AttentionWorkspaceSlice {
  return {
    sessionStatuses: {},
    permissions: [],
    questions: [],
    ...overrides,
  };
}

describe("selectChatAttention", () => {
  it("returns waiting over working when permission and busy live in different workspaces", () => {
    // Given
    const workspaceStates = {
      "ws-a": makeSlice({ sessionStatuses: { s1: BUSY } }),
      "ws-b": makeSlice({ permissions: [makePermission("p1")] }),
    };

    // When
    const result = selectChatAttention({
      workspaceStates,
      connectedWorkspaceIds: ["ws-a", "ws-b"],
      optimisticStreamingSessionId: null,
    });

    // Then
    expect(result).toBe("waiting");
  });

  it("returns waiting when a question is pending", () => {
    const result = selectChatAttention({
      workspaceStates: {
        "ws-a": makeSlice({ questions: [makeQuestion("q1")] }),
      },
      connectedWorkspaceIds: ["ws-a"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("waiting");
  });

  it("counts retry status as working", () => {
    const result = selectChatAttention({
      workspaceStates: {
        "ws-a": makeSlice({ sessionStatuses: { s1: RETRY } }),
      },
      connectedWorkspaceIds: ["ws-a"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("working");
  });

  it("ignores busy status in a workspace that is not connected", () => {
    const result = selectChatAttention({
      workspaceStates: {
        "ws-a": makeSlice({ sessionStatuses: { s1: IDLE } }),
        "ws-b": makeSlice({ sessionStatuses: { s2: BUSY } }),
      },
      connectedWorkspaceIds: ["ws-a"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("idle");
  });

  it("ignores permissions and questions in a workspace that is not connected", () => {
    const result = selectChatAttention({
      workspaceStates: {
        "ws-a": makeSlice(),
        "ws-b": makeSlice({
          permissions: [makePermission("p1")],
          questions: [makeQuestion("q1")],
        }),
      },
      connectedWorkspaceIds: ["ws-a"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("idle");
  });

  it("skips connected ids that have no workspace state", () => {
    const result = selectChatAttention({
      workspaceStates: {},
      connectedWorkspaceIds: ["ws-missing"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("idle");
  });

  it("returns working when only an optimistic streaming session id is set", () => {
    const result = selectChatAttention({
      workspaceStates: {},
      connectedWorkspaceIds: [],
      optimisticStreamingSessionId: "sess-optimistic",
    });

    expect(result).toBe("working");
  });

  it("returns idle when every status is idle and nothing is pending", () => {
    const result = selectChatAttention({
      workspaceStates: {
        "ws-a": makeSlice({ sessionStatuses: { s1: IDLE, s2: IDLE } }),
      },
      connectedWorkspaceIds: ["ws-a"],
      optimisticStreamingSessionId: null,
    });

    expect(result).toBe("idle");
  });
});

describe("resolveTabAttention", () => {
  const cases: ReadonlyArray<[ChatAttention, boolean, TabAttention]> = [
    ["waiting", false, "waiting"],
    ["waiting", true, "waiting"],
    ["working", false, "working"],
    ["working", true, "working"],
    ["idle", true, "unread"],
    ["idle", false, "none"],
  ];

  it.each(cases)(
    "maps chat %s with unseen=%s to %s",
    (chatAttention, hasUnseenFinished, expected) => {
      expect(resolveTabAttention(chatAttention, hasUnseenFinished)).toBe(
        expected,
      );
    },
  );
});

describe("constants", () => {
  it("exposes dot colors and blink interval", () => {
    expect(TAB_ATTENTION_DOT_COLORS).toEqual({
      waiting: "#ef4444",
      working: "#f59e0b",
      unread: "#3b82f6",
    });
    expect(FAVICON_BLINK_INTERVAL_MS).toBe(1000);
  });
});
