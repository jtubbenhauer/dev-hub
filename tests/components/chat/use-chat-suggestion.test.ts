import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatSuggestion } from "@/components/chat/use-chat-suggestion";
import type { MessageWithParts } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

vi.mock("@/hooks/use-settings", () => ({
  useChatSuggestionsSetting: () => ({
    isChatSuggestionsEnabled: true,
    isLoading: false,
  }),
}));

function makeWorkspace(messages: MessageWithParts[]): WorkspaceState {
  return {
    sessionsLoaded: true,
    sessions: {},
    messages: { "sess-1": messages },
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set<string>(),
    sessionNotes: {},
  };
}

// Every streamed token gives the session a new messages array.
function replaceSessionMessages() {
  act(() => {
    useChatStore.setState({ workspaceStates: { "ws-1": makeWorkspace([]) } });
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  useChatStore.setState({ workspaceStates: { "ws-1": makeWorkspace([]) } });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ workspaceStates: {} });
  vi.unstubAllGlobals();
});

describe("useChatSuggestion", () => {
  it("does not re-render while a reply streams in", () => {
    // Given
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useChatSuggestion({
        workspaceId: "ws-1",
        sessionId: "sess-1",
        typedText: "",
        isStreaming: true,
        isEnabled: true,
        isLiveCompletionEnabled: false,
      });
    });
    const rendersBefore = renders;

    // When
    replaceSessionMessages();

    // Then
    expect(renders).toBe(rendersBefore);
  });
});
