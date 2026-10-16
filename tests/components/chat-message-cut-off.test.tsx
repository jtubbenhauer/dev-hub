import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessage, isMessageVisible } from "@/components/chat/message";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import type { MessageWithParts } from "@/lib/opencode/types";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

const hiddenDetails = {
  showThinking: false,
  showToolCalls: false,
  showTokens: false,
  showTimestamps: false,
  shouldCollapseFinishedThinking: false,
};

function makeThinkingOnlyReply(finish: string): MessageWithParts {
  return {
    info: {
      id: "msg-reply",
      sessionID: "sess-1",
      role: "assistant",
      time: { created: 1_000, completed: 312_000 },
      parentID: "msg-user",
      modelID: "claude-opus-5-5",
      providerID: "anthropic",
      mode: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 1.42,
      tokens: {
        input: 4,
        output: 0,
        reasoning: 32_000,
        cache: { read: 116_404, write: 151_155 },
      },
      finish,
    },
    parts: [
      {
        id: "msg-reply-reasoning",
        sessionID: "sess-1",
        messageID: "msg-reply",
        type: "reasoning" as const,
        text: "Planning the next step…",
        time: { start: 13_000, end: 311_000 },
      },
    ],
  };
}

function renderMessage(ui: React.ReactElement) {
  return render(
    <ChatDisplayContext.Provider value={hiddenDetails}>
      {ui}
    </ChatDisplayContext.Provider>,
  );
}

describe("replies cut off at the output limit", () => {
  it("stay visible with thinking hidden, unlike a finished thinking-only reply", () => {
    expect(
      isMessageVisible(makeThinkingOnlyReply("length"), hiddenDetails),
    ).toBe(true);
    expect(isMessageVisible(makeThinkingOnlyReply("stop"), hiddenDetails)).toBe(
      false,
    );
  });

  it("say the reply stopped at the output limit and how many tokens it used", () => {
    renderMessage(<ChatMessage message={makeThinkingOnlyReply("length")} />);

    expect(
      screen.getByText(
        `This reply stopped at the output limit (${(32_000).toLocaleString()} tokens) before it finished.`,
      ),
    ).toBeInTheDocument();
  });

  it("offer Continue only when the chat passes a continue handler", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const { unmount } = renderMessage(
      <ChatMessage
        message={makeThinkingOnlyReply("length")}
        onContinue={onContinue}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
    unmount();

    renderMessage(<ChatMessage message={makeThinkingOnlyReply("length")} />);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("show no notice on replies that finished normally", () => {
    renderMessage(
      <ChatMessage
        message={makeThinkingOnlyReply("stop")}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.queryByText(/output limit/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});
