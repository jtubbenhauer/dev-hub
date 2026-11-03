import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { PromptInput } from "@/components/chat/prompt-input";
import {
  attachCommentToChat,
  type CommentChip,
} from "@/lib/comment-chat-bridge";
import { queueTerminalOutputForChat } from "@/lib/terminal-chat-bridge";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: vi.fn(() => undefined),
      getQueriesData: vi.fn(() => []),
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/chat/file-picker", () => ({ FilePicker: () => null }));
vi.mock("@/components/chat/command-picker", () => ({
  CommandPicker: () => null,
}));
vi.mock("@/components/chat/plan-arg-picker", () => ({
  PlanArgPicker: () => null,
}));
vi.mock("@/components/chat/agent-selector", () => ({
  AgentSelector: () => null,
}));
vi.mock("@/components/chat/model-selector", () => ({
  ModelSelector: () => null,
}));
vi.mock("@/components/chat/variant-selector", () => ({
  VariantSelector: () => null,
}));
vi.mock("@/components/chat/omo-permission-preset-selector", () => ({
  OmoPermissionPresetSelector: () => null,
}));
vi.mock("@/components/chat/context-usage-indicator", () => ({
  ContextUsageIndicator: () => null,
}));
vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: () => ({ allowlist: [], setAllowlist: vi.fn() }),
  useChatSuggestionsSetting: () => ({
    isChatSuggestionsEnabled: false,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: vi.fn().mockReturnValue(null),
}));
vi.mock("@/components/chat/pr-picker", () => ({ PrPicker: () => null }));

const WORKSPACE_ID = "w1";
const TERMINAL_OUTPUT_KEY = `devhub:pending-terminal-output:${WORKSPACE_ID}`;
const COMMENT_CHIPS_KEY = `devhub:pending-comment-chips:${WORKSPACE_ID}`;

type TabId = "tab-a" | "tab-b";

const baseProps = {
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: WORKSPACE_ID,
  sessionId: null,
  commands: [],
  onCommandSelect: vi.fn(),
  agents: [],
  selectedAgent: null,
  onAgentChange: vi.fn(),
  selectedModel: null,
  onModelChange: vi.fn(),
  availableVariants: [],
  selectedVariant: null,
  onVariantChange: vi.fn(),
};

const reviewChip: CommentChip = {
  id: 7,
  filePath: "src/auth.ts",
  startLine: 42,
  endLine: 42,
  body: "Needs error handling",
  workspaceId: WORKSPACE_ID,
  sessionId: null,
};

function chatTab(
  tabId: TabId,
  isLastFocusedChat: boolean,
): ChatTabContextValue {
  return {
    tabId,
    workspaceId: WORKSPACE_ID,
    sessionId: null,
    isFocused: false,
    isLastFocusedChat,
    isVisible: true,
  };
}

function ChatTabPrompt({
  tabId,
  isEventTarget,
}: {
  readonly tabId: TabId;
  readonly isEventTarget: boolean;
}) {
  return (
    <div data-testid={tabId}>
      <ChatTabProvider value={chatTab(tabId, isEventTarget)}>
        <PromptInput {...baseProps} />
      </ChatTabProvider>
    </div>
  );
}

function TwoChatPrompts({ eventTarget }: { readonly eventTarget: TabId }) {
  return (
    <>
      <ChatTabPrompt tabId="tab-a" isEventTarget={eventTarget === "tab-a"} />
      <ChatTabPrompt tabId="tab-b" isEventTarget={eventTarget === "tab-b"} />
    </>
  );
}

function composerOf(tabId: TabId): HTMLElement {
  return within(screen.getByTestId(tabId)).getByRole("textbox");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("PromptInput in two chat tabs", () => {
  it("fills only the last focused chat with terminal output sent while both are open", () => {
    // Given: tab-a listens first, so it would win an ungated race.
    render(<TwoChatPrompts eventTarget="tab-b" />);

    // When
    act(() => queueTerminalOutputForChat(WORKSPACE_ID, "X"));

    // Then
    expect(composerOf("tab-b")).toHaveValue("X");
    expect(composerOf("tab-a")).toHaveValue("");
  });

  it("picks up output queued before mount only in the last focused chat", () => {
    // Given
    queueTerminalOutputForChat(WORKSPACE_ID, "X");

    // When
    render(<TwoChatPrompts eventTarget="tab-b" />);

    // Then
    expect(composerOf("tab-b")).toHaveValue("X");
    expect(composerOf("tab-a")).toHaveValue("");
    expect(localStorage.getItem(TERMINAL_OUTPUT_KEY)).toBeNull();
  });

  it("leaves queued output for the last focused chat when another chat mounts", () => {
    // Given
    queueTerminalOutputForChat(WORKSPACE_ID, "X");

    // When
    render(<ChatTabPrompt tabId="tab-a" isEventTarget={false} />);

    // Then
    expect(composerOf("tab-a")).toHaveValue("");
    expect(localStorage.getItem(TERMINAL_OUTPUT_KEY)).toBe("X");
  });

  it("hands queued output to the chat that becomes the last focused one", () => {
    // Given
    const { rerender } = render(<TwoChatPrompts eventTarget="tab-a" />);
    localStorage.setItem(TERMINAL_OUTPUT_KEY, "Y");

    // When
    rerender(<TwoChatPrompts eventTarget="tab-b" />);

    // Then
    expect(composerOf("tab-b")).toHaveValue("Y");
    expect(composerOf("tab-a")).toHaveValue("");
    expect(localStorage.getItem(TERMINAL_OUTPUT_KEY)).toBeNull();
  });

  it("attaches a review comment only to the last focused chat", () => {
    // Given: tab-a listens first, so it would win an ungated race.
    render(<TwoChatPrompts eventTarget="tab-b" />);

    // When
    act(() => attachCommentToChat(reviewChip));

    // Then
    expect(
      within(screen.getByTestId("tab-b")).getByText(/auth\.ts:42/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("tab-a")).queryByText(/auth\.ts:42/),
    ).not.toBeInTheDocument();
  });

  it("picks up review comments queued before mount only in the last focused chat", () => {
    // Given
    localStorage.setItem(COMMENT_CHIPS_KEY, JSON.stringify([reviewChip]));

    // When
    render(<TwoChatPrompts eventTarget="tab-b" />);

    // Then
    expect(
      within(screen.getByTestId("tab-b")).getByText(/auth\.ts:42/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("tab-a")).queryByText(/auth\.ts:42/),
    ).not.toBeInTheDocument();
  });
});
