import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChatMessage } from "@/components/chat/message"
import { ChatDisplayContext } from "@/components/chat/chat-display-context"
import type { MessageWithParts } from "@/lib/opencode/types"

// Mock workspace store — ChatMessage reads activeWorkspaceId from it
vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}))

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
  }
}

function makeAssistantMessage(id: string, text: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "sess-1",
      role: "assistant",
      time: { created: Date.now() },
      parentID: "",
      modelID: "claude",
      providerID: "anthropic",
      mode: "default",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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
  }
}

const displaySettings = {
  showThinking: false,
  showToolCalls: false,
  showTokens: false,
  showTimestamps: false,
}

function renderWithContext(ui: React.ReactElement) {
  return render(
    <ChatDisplayContext.Provider value={displaySettings}>
      {ui}
    </ChatDisplayContext.Provider>
  )
}

describe("ChatMessage revert button", () => {
  it("renders revert button on user message when onRevert is provided", () => {
    const onRevert = vi.fn()
    renderWithContext(
      <ChatMessage
        message={makeUserMessage("msg-1", "Hello")}
        onRevert={onRevert}
      />
    )

    const revertButton = screen.getByTitle("Revert to before this message")
    expect(revertButton).toBeInTheDocument()
  })

  it("does not render revert button when onRevert is not provided", () => {
    renderWithContext(
      <ChatMessage message={makeUserMessage("msg-1", "Hello")} />
    )

    expect(screen.queryByTitle("Revert to before this message")).not.toBeInTheDocument()
  })

  it("does not render revert button on assistant messages even when onRevert is provided", () => {
    const onRevert = vi.fn()
    renderWithContext(
      <ChatMessage
        message={makeAssistantMessage("msg-2", "Hi there")}
        onRevert={onRevert}
      />
    )

    expect(screen.queryByTitle("Revert to before this message")).not.toBeInTheDocument()
  })

  it("calls onRevert with the message ID when clicked", async () => {
    const user = userEvent.setup()
    const onRevert = vi.fn()
    renderWithContext(
      <ChatMessage
        message={makeUserMessage("msg-42", "Test message")}
        onRevert={onRevert}
      />
    )

    const revertButton = screen.getByTitle("Revert to before this message")
    await user.click(revertButton)

    expect(onRevert).toHaveBeenCalledOnce()
    expect(onRevert).toHaveBeenCalledWith("msg-42")
  })
})
