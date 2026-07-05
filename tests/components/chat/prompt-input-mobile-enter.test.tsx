import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PromptInput } from "@/components/chat/prompt-input";
import { useHasCoarsePointer } from "@/hooks/use-mobile";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
  useHasCoarsePointer: vi.fn(() => false),
}));

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

vi.mock("@/components/chat/file-picker", () => ({
  FilePicker: () => null,
}));
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
vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: () => ({ allowlist: [], setAllowlist: vi.fn() }),
}));
vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: vi.fn().mockReturnValue(null),
}));
vi.mock("@/components/chat/pr-picker", () => ({
  PrPicker: () => null,
}));

const baseProps = {
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: "ws-1",
  sessionId: "session-1",
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
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PromptInput — Enter key behavior across pointer types", () => {
  it("submits on desktop (fine pointer) when Enter is pressed without shift", () => {
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    const onSubmit = vi.fn();

    const { container } = render(
      <PromptInput {...baseProps} onSubmit={onSubmit} />,
    );

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea!, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on coarse-pointer touch devices when Enter is pressed", () => {
    vi.mocked(useHasCoarsePointer).mockReturnValue(true);
    const onSubmit = vi.fn();

    const { container } = render(
      <PromptInput {...baseProps} onSubmit={onSubmit} />,
    );

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea!, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit on desktop when Shift+Enter is pressed (existing newline behavior)", () => {
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    const onSubmit = vi.fn();

    const { container } = render(
      <PromptInput {...baseProps} onSubmit={onSubmit} />,
    );

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea!, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
