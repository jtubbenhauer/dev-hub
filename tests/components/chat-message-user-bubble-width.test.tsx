import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChatMessage } from "@/components/chat/message";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import type { MessageWithParts } from "@/lib/opencode/types";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

// A single unbreakable token far wider than any chat pane. Without an explicit
// max-width the bubble is a flex item whose automatic minimum size equals its
// min-content width, so it refuses to shrink and spills out the left edge.
const LONG_UNBREAKABLE_TOKEN =
  "/Users/someone/.cache/opencode/packages/oh-my-openagent@4.19.4/node_modules/oh-my-openagent/dist/skills/start-work/";

function makeUserMessage(id: string, text: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "sess-1",
      role: "user",
      time: { created: Date.now() },
      agent: "",
      model: { providerID: "", modelID: "" },
    },
    parts: [
      {
        id: `${id}-part`,
        sessionID: "sess-1",
        messageID: id,
        type: "text" as const,
        text,
      },
    ],
  };
}

const displaySettings = {
  showThinking: false,
  showToolCalls: false,
  showTokens: false,
  showTimestamps: false,
};

function renderUserMessage(text: string) {
  const { container } = render(
    <ChatDisplayContext.Provider value={displaySettings}>
      <ChatMessage message={makeUserMessage("msg-1", text)} />
    </ChatDisplayContext.Provider>,
  );

  const prose = container.querySelector(".user-bubble-prose");
  if (!prose) throw new Error("user bubble prose container not rendered");

  const bubble = prose.parentElement;
  if (!bubble) throw new Error("user bubble not rendered");

  const bubbleRow = bubble.parentElement;
  if (!bubbleRow) throw new Error("user bubble row not rendered");

  return { prose, bubble, bubbleRow };
}

describe("user message bubble width constraints", () => {
  it("caps the bubble at the width of its column so long content cannot overflow", () => {
    const { bubble } = renderUserMessage(LONG_UNBREAKABLE_TOKEN);

    expect(bubble.classList.contains("max-w-full")).toBe(true);
  });

  it("caps the row wrapping the bubble so the bubble has a bounded parent to fill", () => {
    const { bubbleRow } = renderUserMessage(LONG_UNBREAKABLE_TOKEN);

    expect(bubbleRow.classList.contains("max-w-full")).toBe(true);
  });

  it("keeps the prose container wrapping long words instead of clipping them", () => {
    const { prose } = renderUserMessage(LONG_UNBREAKABLE_TOKEN);

    expect(prose.classList.contains("break-words")).toBe(true);
    expect(prose.classList.contains("max-w-full")).toBe(true);
  });

  it("still applies the width cap to short messages so they shrink to fit", () => {
    const { bubble, bubbleRow } = renderUserMessage("Hello");

    expect(bubble.classList.contains("max-w-full")).toBe(true);
    expect(bubbleRow.classList.contains("max-w-full")).toBe(true);
    // max-w-full only caps; it must not force the bubble to fill the column.
    expect(bubble.classList.contains("w-full")).toBe(false);
  });
});
