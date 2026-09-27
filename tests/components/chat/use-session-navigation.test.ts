import { act, renderHook } from "@testing-library/react";
import { useSessionNavigation } from "@/components/chat/use-session-navigation";
import type { Agent } from "@/lib/opencode/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  setSessionAgent: vi.fn(),
  setSessionModel: vi.fn(),
  clearSessionModel: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => storeMocks),
  },
}));

function agent(name: string): Agent {
  return {
    name,
    description: name,
    mode: "primary",
    native: false,
    hidden: false,
    topP: 1,
    temperature: 1,
    color: "#000000",
    permission: [],
    options: {},
  };
}

describe("useSessionNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderWithChatInput(setSelectedAgent = vi.fn()) {
    const chatInterface = document.createElement("div");
    chatInterface.dataset.chatInterface = "";
    const input = document.createElement("input");
    chatInterface.append(input);
    document.body.append(chatInterface);
    renderHook(() =>
      useSessionNavigation({
        orderedAgents: [
          agent("Prometheus"),
          agent("Hephaestus"),
          agent("Atlas"),
        ],
        selectedAgent: "Prometheus",
        setSelectedAgent,
        activeSessionId: "session-1",
        activeWorkspaceId: "workspace-1",
        setSelectedModel: vi.fn(),
      }),
    );
    const pressKey = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      act(() => {
        input.dispatchEvent(event);
      });
      return event;
    };
    return {
      setSelectedAgent,
      pressKey,
      cleanup: () => chatInterface.remove(),
    };
  }

  it("cycles to the next agent with Ctrl+. and clears the session model", () => {
    const { setSelectedAgent, pressKey, cleanup } = renderWithChatInput();

    const event = pressKey({ key: ".", code: "Period", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(setSelectedAgent).toHaveBeenCalledWith("Hephaestus");
    expect(storeMocks.setSessionAgent).toHaveBeenCalledWith(
      "session-1",
      "workspace-1",
      "Hephaestus",
    );
    expect(storeMocks.clearSessionModel).toHaveBeenCalledWith(
      "session-1",
      "workspace-1",
    );
    cleanup();
  });

  it("cycles to the previous agent with Ctrl+Shift+.", () => {
    const { setSelectedAgent, pressKey, cleanup } = renderWithChatInput();

    pressKey({ key: ">", code: "Period", ctrlKey: true, shiftKey: true });

    expect(setSelectedAgent).toHaveBeenCalledWith("Atlas");
    cleanup();
  });

  it("no longer cycles agents on Tab or Shift+Tab", () => {
    const { setSelectedAgent, pressKey, cleanup } = renderWithChatInput();

    const tabEvent = pressKey({ key: "Tab", code: "Tab" });
    const shiftTabEvent = pressKey({ key: "Tab", code: "Tab", shiftKey: true });

    expect(tabEvent.defaultPrevented).toBe(false);
    expect(shiftTabEvent.defaultPrevented).toBe(false);
    expect(setSelectedAgent).not.toHaveBeenCalled();
    cleanup();
  });

  it("ignores Cmd+. and a plain period", () => {
    const { setSelectedAgent, pressKey, cleanup } = renderWithChatInput();

    pressKey({ key: ".", code: "Period", metaKey: true });
    pressKey({ key: ".", code: "Period" });

    expect(setSelectedAgent).not.toHaveBeenCalled();
    cleanup();
  });
});
