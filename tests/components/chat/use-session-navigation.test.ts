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

  it("clears the previous session model when Tab cycles agents", () => {
    const setSelectedAgent = vi.fn();
    const chatInterface = document.createElement("div");
    chatInterface.dataset.chatInterface = "";
    const input = document.createElement("input");
    chatInterface.append(input);
    document.body.append(chatInterface);

    renderHook(() =>
      useSessionNavigation({
        orderedAgents: [agent("Prometheus"), agent("Hephaestus")],
        selectedAgent: "Prometheus",
        setSelectedAgent,
        activeSessionId: "session-1",
        activeWorkspaceId: "workspace-1",
        setSelectedModel: vi.fn(),
      }),
    );

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });

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

    chatInterface.remove();
  });
});
