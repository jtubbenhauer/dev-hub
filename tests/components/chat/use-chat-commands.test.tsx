import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseCommand, mockUseLeaderAction } = vi.hoisted(() => ({
  mockUseCommand: vi.fn(),
  mockUseLeaderAction: vi.fn(),
}));

vi.mock("@/hooks/use-command", () => ({ useCommand: mockUseCommand }));
vi.mock("@/hooks/use-leader-action", () => ({
  useLeaderAction: mockUseLeaderAction,
}));

import { useChatCommands } from "@/components/chat/use-chat-commands";

const COLLAPSE_COMMAND_ID = "chat:toggle-collapse-finished-thinking";
const COLLAPSE_STORAGE_KEY = "dev-hub:chat-collapse-finished-thinking";

interface RegisteredCommand {
  id: string;
  label: string;
  onSelect: () => void;
}

interface RegisteredLeaderAction {
  action: { id: string };
  handler: () => void;
}

function renderChatCommands() {
  return renderHook(() => {
    const [shouldCollapseFinishedThinking, setShouldCollapseFinishedThinking] =
      useState(false);
    useChatCommands(
      {
        handleCreateSession: { current: vi.fn() },
        setIsPlanPanelOpen: { current: vi.fn() },
        setIsSessionListOpen: { current: vi.fn() },
        setIsModelSelectorOpen: { current: vi.fn() },
        setIsAgentSelectorOpen: { current: vi.fn() },
        promptInput: { current: null },
        jumpToNextUserMessage: { current: vi.fn() },
        jumpToPrevUserMessage: { current: vi.fn() },
        jumpToFirstUserMessage: { current: vi.fn() },
        jumpToLastUserMessage: { current: vi.fn() },
      },
      {
        isPlanPanelOpen: false,
        isSidePanelOpen: false,
        showThinking: true,
        showToolCalls: true,
        showTokens: true,
        showTimestamps: false,
        shouldCollapseFinishedThinking,
      },
      {
        setShowThinking: vi.fn(),
        setShowToolCalls: vi.fn(),
        setShowTokens: vi.fn(),
        setShowTimestamps: vi.fn(),
        setShouldCollapseFinishedThinking,
      },
    );
    return shouldCollapseFinishedThinking;
  });
}

function getLatestCollapseCommand(): RegisteredCommand {
  const commands = (mockUseCommand.mock.lastCall?.[0] ??
    []) as RegisteredCommand[];
  const command = commands.find(({ id }) => id === COLLAPSE_COMMAND_ID);
  if (!command) throw new Error(`${COLLAPSE_COMMAND_ID} is not registered`);
  return command;
}

function getLatestCollapseLeaderAction(): RegisteredLeaderAction {
  const registrations = (mockUseLeaderAction.mock.lastCall?.[0] ??
    []) as RegisteredLeaderAction[];
  const registration = registrations.find(
    ({ action }) => action.id === COLLAPSE_COMMAND_ID,
  );
  if (!registration) {
    throw new Error(`${COLLAPSE_COMMAND_ID} leader action is not registered`);
  }
  return registration;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(COLLAPSE_STORAGE_KEY);
});

describe("collapse finished thinking toggle", () => {
  it("turns collapsing on and off from the command palette and remembers the choice", () => {
    const { result } = renderChatCommands();
    expect(getLatestCollapseCommand().label).toBe("Collapse Finished Thinking");

    act(() => getLatestCollapseCommand().onSelect());

    expect(result.current).toBe(true);
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("true");
    expect(getLatestCollapseCommand().label).toBe("Expand Finished Thinking");

    act(() => getLatestCollapseCommand().onSelect());

    expect(result.current).toBe(false);
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("false");
  });

  it("can also be toggled with a leader key action", () => {
    const { result } = renderChatCommands();

    act(() => getLatestCollapseLeaderAction().handler());

    expect(result.current).toBe(true);
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("true");
  });
});
