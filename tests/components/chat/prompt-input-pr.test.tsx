import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptInput } from "@/components/chat/prompt-input";

vi.mock("@/lib/comment-chat-bridge", () => ({
  getPendingCommentChips: vi.fn((_workspaceId: string) => []),
  clearPendingCommentChips: vi.fn((_workspaceId: string) => undefined),
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

vi.mock("@/components/chat/pr-picker", () => ({
  PrPicker: ({
    query,
    onSelect,
    onDismiss,
  }: {
    query: string;
    onSelect: (prNumber: number) => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="pr-picker" data-query={query}>
      <button onClick={() => onSelect(42)}>Select PR 42</button>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: vi.fn(),
}));

vi.mock("@/lib/pr-context", () => ({
  fetchPrContext: vi.fn(),
  formatPrContextForAI: vi.fn(),
}));

import { useWorkspaceGitHub } from "@/hooks/use-git";
import { fetchPrContext, formatPrContextForAI } from "@/lib/pr-context";

const mockUseWorkspaceGitHub = useWorkspaceGitHub as ReturnType<typeof vi.fn>;
const mockFetchPrContext = fetchPrContext as ReturnType<typeof vi.fn>;
const mockFormatPrContextForAI = formatPrContextForAI as ReturnType<
  typeof vi.fn
>;

const baseProps = {
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: "ws-1",
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

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mockUseWorkspaceGitHub.mockReturnValue({ owner: "acme", repo: "myapp" });
  mockFetchPrContext.mockResolvedValue({
    pr: {
      number: 42,
      title: "Fix the bug",
      state: "open",
      draft: false,
      merge_commit_sha: null,
      user: { login: "alice" },
      head: { ref: "fix/bug" },
      base: { ref: "main" },
    },
    files: [],
    diff: "diff content",
    truncated: false,
  });
  mockFormatPrContextForAI.mockReturnValue("PR #42: Fix the bug\nStatus: open");
});

afterEach(() => {
  cleanup();
});

describe("PromptInput — PR mention trigger", () => {
  describe("# trigger detection", () => {
    it("shows PrPicker when # is typed at start of input", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");

      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });
    });

    it("shows PrPicker when # is typed after whitespace", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "check #");

      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });
    });

    it("passes digits after # as query to PrPicker", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#12");

      await waitFor(() => {
        const picker = screen.getByTestId("pr-picker");
        expect(picker).toHaveAttribute("data-query", "12");
      });
    });

    it("does not show PrPicker when githubRepo is null", async () => {
      mockUseWorkspaceGitHub.mockReturnValue(null);
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");

      expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
    });

    it("does not show PrPicker for inline # (no whitespace before)", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "abc#");

      expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
    });
  });

  describe("picker dismiss", () => {
    it("closes PrPicker when Dismiss is clicked", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
    });

    it("closes PrPicker on Escape keydown", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");

      expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
    });
  });

  describe("PR selection flow", () => {
    it("closes PrPicker after selecting a PR", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
      });
    });

    it("shows PR context chip after selecting a PR", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.getByText(/42: Fix the bug/)).toBeInTheDocument();
      });
    });

    it("removes PR chip when X button is clicked", async () => {
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.getByText(/42: Fix the bug/)).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Remove PR #42/i }));

      expect(screen.queryByText(/42: Fix the bug/)).not.toBeInTheDocument();
    });

    it("prepends PR context string before user message on submit", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.getByText(/42: Fix the bug/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "please review this");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const submitted = onSubmit.mock.calls[0][0] as string;
      const prContextIdx = submitted.indexOf("PR #42: Fix the bug");
      const messageIdx = submitted.indexOf("please review this");
      expect(prContextIdx).toBeGreaterThanOrEqual(0);
      expect(messageIdx).toBeGreaterThan(prContextIdx);
    });

    it("clears PR context chips after submit", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.getByText(/42: Fix the bug/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "submit");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      expect(screen.queryByText(/42: Fix the bug/)).not.toBeInTheDocument();
    });

    it("skips adding PR chip when fetchPrContext throws", async () => {
      mockFetchPrContext.mockRejectedValue(new Error("network error"));
      const user = userEvent.setup();
      render(<PromptInput {...baseProps} />);

      await user.type(screen.getByRole("textbox"), "#");
      await waitFor(() => {
        expect(screen.getByTestId("pr-picker")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Select PR 42" }));

      await waitFor(() => {
        expect(screen.queryByTestId("pr-picker")).not.toBeInTheDocument();
      });

      expect(screen.queryByText(/42: Fix the bug/)).not.toBeInTheDocument();
    });
  });

  describe("placeholder text", () => {
    it("mentions # for PRs in placeholder", () => {
      render(<PromptInput {...baseProps} />);

      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveAttribute(
        "placeholder",
        "Send a message... (@ for files, # for PRs)",
      );
    });
  });
});
