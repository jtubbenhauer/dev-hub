import { describe, expect, it } from "vitest";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import type { Session } from "@/lib/opencode/types";

function createSession(id: string): Session {
  return {
    id,
    projectID: "project-1",
    directory: "/repo",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function createWorkspaceState(input: {
  readonly sessionIds: readonly string[];
  readonly sessionsLoaded: boolean;
}) {
  return {
    sessionsLoaded: input.sessionsLoaded,
    sessions: Object.fromEntries(
      input.sessionIds.map((id) => [id, createSession(id)]),
    ),
  };
}

describe("getEffectiveChatSessionId", () => {
  it("returns null when no session is requested", () => {
    // Given
    const workspaceState = createWorkspaceState({
      sessionIds: ["ses_1"],
      sessionsLoaded: true,
    });

    // When
    const effectiveSessionId = getEffectiveChatSessionId(workspaceState, null);

    // Then
    expect(effectiveSessionId).toBeNull();
  });

  it("keeps the session when the workspace has no chat state yet", () => {
    // When
    const effectiveSessionId = getEffectiveChatSessionId(undefined, "ses_1");

    // Then
    expect(effectiveSessionId).toBe("ses_1");
  });

  it("keeps an unseen session while the session list is still loading", () => {
    // Given
    const workspaceState = createWorkspaceState({
      sessionIds: [],
      sessionsLoaded: false,
    });

    // When
    const effectiveSessionId = getEffectiveChatSessionId(
      workspaceState,
      "ses_unseen",
    );

    // Then
    expect(effectiveSessionId).toBe("ses_unseen");
  });

  it("keeps a session the loaded list contains", () => {
    // Given
    const workspaceState = createWorkspaceState({
      sessionIds: ["ses_1", "ses_2"],
      sessionsLoaded: true,
    });

    // When
    const effectiveSessionId = getEffectiveChatSessionId(
      workspaceState,
      "ses_2",
    );

    // Then
    expect(effectiveSessionId).toBe("ses_2");
  });

  it("drops a session the loaded list does not contain", () => {
    // Given
    const workspaceState = createWorkspaceState({
      sessionIds: ["ses_1"],
      sessionsLoaded: true,
    });

    // When
    const effectiveSessionId = getEffectiveChatSessionId(
      workspaceState,
      "ses_deleted",
    );

    // Then
    expect(effectiveSessionId).toBeNull();
  });

  it("does not mistake an inherited object key for a loaded session", () => {
    // Given
    const workspaceState = createWorkspaceState({
      sessionIds: [],
      sessionsLoaded: true,
    });

    // When
    const effectiveSessionId = getEffectiveChatSessionId(
      workspaceState,
      "constructor",
    );

    // Then
    expect(effectiveSessionId).toBeNull();
  });
});
