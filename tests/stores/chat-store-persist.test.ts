import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

const SAVED_CHAT_STATE_KEY = "dev-hub-chat";

function makeWorkspace(): WorkspaceState {
  return {
    sessionsLoaded: true,
    sessions: {},
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set<string>(),
    sessionNotes: {},
  };
}

let setItem: MockInstance<Storage["setItem"]>;

function savedChatStateWrites(): string[] {
  return setItem.mock.calls
    .filter(([key]) => key === SAVED_CHAT_STATE_KEY)
    .map(([, value]) => value);
}

beforeEach(() => {
  useChatStore.setState({
    activeSessionId: null,
    workspaceStates: { "ws-1": makeWorkspace() },
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
  });
  setItem = vi.spyOn(Storage.prototype, "setItem");
});

afterEach(() => {
  setItem.mockRestore();
  useChatStore.setState({
    workspaceStates: {},
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
  });
});

describe("chat store persistence", () => {
  it("does not rewrite the saved chat state when only messages change", () => {
    // Given
    useChatStore.getState().setSessionAgent("sess-1", "ws-1", "build");
    setItem.mockClear();

    // When
    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        "ws-1": {
          ...state.workspaceStates["ws-1"],
          messages: { "sess-1": [] },
        },
      },
    }));

    // Then
    expect(savedChatStateWrites()).toEqual([]);
  });

  it.each([
    {
      change: "an agent choice",
      apply: () =>
        useChatStore.getState().setSessionAgent("sess-1", "ws-1", "plan"),
    },
    {
      change: "a queued message",
      apply: () =>
        useChatStore.setState({
          queuedMessages: new Map([
            [
              "ws-1",
              [
                {
                  sessionId: "sess-1",
                  text: "pending",
                  workspaceId: "ws-1",
                  optimisticMessageId: "optimistic-1",
                },
              ],
            ],
          ]),
        }),
    },
  ])("saves the chat state when $change changes", ({ apply }) => {
    // When
    apply();

    // Then
    expect(savedChatStateWrites()).toHaveLength(1);
  });
});
