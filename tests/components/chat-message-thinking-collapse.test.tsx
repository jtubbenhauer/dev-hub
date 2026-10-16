import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessage } from "@/components/chat/message";
import {
  ChatDisplayContext,
  type ChatDisplaySettings,
} from "@/components/chat/chat-display-context";
import type { MessageWithParts } from "@/lib/opencode/types";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

function makeReplyWithThinking(
  thinkingEnd: number | undefined,
): MessageWithParts {
  return {
    info: {
      id: "msg-reply",
      sessionID: "sess-1",
      role: "assistant",
      time: { created: 1_000 },
      parentID: "msg-user",
      modelID: "claude-opus-5-5",
      providerID: "anthropic",
      mode: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: "msg-reply-reasoning",
        sessionID: "sess-1",
        messageID: "msg-reply",
        type: "reasoning" as const,
        text: "Weighing the options…",
        time: { start: 1_000, end: thinkingEnd },
      },
    ],
  };
}

function displaySettings(
  shouldCollapseFinishedThinking: boolean,
): ChatDisplaySettings {
  return {
    showThinking: true,
    showToolCalls: true,
    showTokens: false,
    showTimestamps: false,
    shouldCollapseFinishedThinking,
  };
}

function renderReply(
  message: MessageWithParts,
  shouldCollapseFinishedThinking: boolean,
) {
  return render(
    <ChatDisplayContext.Provider
      value={displaySettings(shouldCollapseFinishedThinking)}
    >
      <ChatMessage message={message} />
    </ChatDisplayContext.Provider>,
  );
}

function getThinkingToggle() {
  return screen.getByRole("button", { name: /^Thinking/ });
}

describe("collapsing finished thinking", () => {
  it("shows finished thinking collapsed when collapsing is on", () => {
    renderReply(makeReplyWithThinking(5_000), true);

    expect(getThinkingToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps thinking open while it streams, then collapses it once it finishes", () => {
    const { rerender } = renderReply(makeReplyWithThinking(undefined), true);
    expect(getThinkingToggle()).toHaveAttribute("aria-expanded", "true");

    rerender(
      <ChatDisplayContext.Provider value={displaySettings(true)}>
        <ChatMessage message={makeReplyWithThinking(5_000)} />
      </ChatDisplayContext.Provider>,
    );

    expect(getThinkingToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("lets the user reopen collapsed thinking", async () => {
    const user = userEvent.setup();
    renderReply(makeReplyWithThinking(5_000), true);

    await user.click(getThinkingToggle());

    expect(getThinkingToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps finished thinking expanded when collapsing is off", () => {
    renderReply(makeReplyWithThinking(5_000), false);

    expect(getThinkingToggle()).toHaveAttribute("aria-expanded", "true");
  });
});
