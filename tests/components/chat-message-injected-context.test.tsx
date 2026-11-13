import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessage } from "@/components/chat/message";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import { createAttachmentPromptPart } from "@/lib/attachment-utils";
import type { MessageWithParts, Part } from "@/lib/opencode/types";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

const displaySettings = {
  showThinking: false,
  showToolCalls: false,
  showTokens: false,
  showTimestamps: false,
  shouldCollapseFinishedThinking: false,
};

const TYPED_TEXT = "Why does scrolling stutter?";
const RECALL_DIRECTIVE =
  "<supermemory-recall>\nBefore responding, decide whether to recall memory.\n</supermemory-recall>";
const SUPERMEMORY_CONTEXT = [
  "[SUPERMEMORY]",
  "",
  "Recent Context:",
  "- [2026-11-12] include_co_authored_by is false.",
  "",
  "[SUPERMEMORY UPDATE]",
  "Supermemory update available: v2.0.13 -> v2.1.2",
  "Run (if you have a JS runtime): bunx opencode-supermemory@latest install",
].join("\n");

function textPart(id: string, text: string, isSynthetic = false): Part {
  return {
    id,
    sessionID: "sess-1",
    messageID: "msg-1",
    type: "text",
    text,
    ...(isSynthetic ? { synthetic: true } : {}),
  };
}

function renderUserMessage(parts: Part[]) {
  const message: MessageWithParts = {
    info: {
      id: "msg-1",
      sessionID: "sess-1",
      role: "user",
      time: { created: Date.now() },
      agent: "",
      model: { providerID: "", modelID: "" },
    },
    parts,
  };
  return render(
    <ChatDisplayContext.Provider value={displaySettings}>
      <ChatMessage message={message} />
    </ChatDisplayContext.Provider>,
  );
}

describe("user message injected context", () => {
  it("keeps plugin text out of the bubble until the disclosure is opened", async () => {
    const user = userEvent.setup();
    renderUserMessage([
      textPart("prt-typed", TYPED_TEXT),
      textPart("prt-recall", RECALL_DIRECTIVE, true),
    ]);

    expect(screen.getByText(TYPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/supermemory-recall/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByText(/supermemory-recall/)).toBeInTheDocument();
  });

  it("shows a plugin's update notice without opening the injected context", () => {
    renderUserMessage([
      textPart("prt-typed", TYPED_TEXT),
      textPart("prt-context", SUPERMEMORY_CONTEXT, true),
    ]);

    expect(
      screen.getByText("Supermemory update available: v2.0.13 -> v2.1.2"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Recent Context/)).not.toBeInTheDocument();
  });

  it("shows an inlined attachment as a chip instead of its content", () => {
    const attachmentPart = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${btoa("name,city\nAda,London\n")}`,
      filename: "rows.csv",
    });
    if (attachmentPart.type !== "text") throw new Error("expected text part");

    renderUserMessage([
      textPart("prt-typed", TYPED_TEXT),
      textPart("prt-csv", attachmentPart.text, true),
    ]);

    expect(screen.getByText("rows.csv")).toBeInTheDocument();
    expect(screen.queryByText(/Ada,London/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a turn made only of injected text as the disclosure alone", () => {
    const { container } = renderUserMessage([
      textPart("prt-recall", RECALL_DIRECTIVE, true),
    ]);

    expect(container.querySelector(".user-bubble-prose")).toBeNull();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });
});
