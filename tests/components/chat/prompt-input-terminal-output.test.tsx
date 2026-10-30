import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptInput } from "@/components/chat/prompt-input";
import { queueTerminalOutputForChat } from "@/lib/terminal-chat-bridge";

vi.mock("@/lib/comment-chat-bridge", () => ({
  getPendingCommentChips: vi.fn(() => []),
  clearPendingCommentChips: vi.fn(),
  removePendingCommentChip: vi.fn(),
  attachCommentToChat: vi.fn(),
  getAllCachedComments: vi.fn(() => []),
}));

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

const baseProps = {
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: "ws-1",
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

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("PromptInput — terminal output", () => {
  it("fills the composer with output queued before the chat mounted", () => {
    queueTerminalOutputForChat("ws-1", "Terminal output (T):\nboom");
    render(<PromptInput {...baseProps} sessionId="terminal-mount" />);
    expect(screen.getByRole("textbox")).toHaveValue(
      "Terminal output (T):\nboom",
    );
    expect(
      localStorage.getItem("devhub:pending-terminal-output:ws-1"),
    ).toBeNull();
  });

  it("appends output sent while the chat is open to the existing draft", async () => {
    render(<PromptInput {...baseProps} sessionId="terminal-live" />);
    await userEvent.type(screen.getByRole("textbox"), "Why?");
    act(() => {
      queueTerminalOutputForChat("ws-1", "Terminal output (T):\nerror");
    });
    expect(screen.getByRole("textbox")).toHaveValue(
      "Why?\n\nTerminal output (T):\nerror",
    );
  });

  it("ignores output queued for another workspace", () => {
    queueTerminalOutputForChat("ws-2", "other");
    render(<PromptInput {...baseProps} sessionId="terminal-other" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
