import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
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

import {
  getPendingCommentChips,
  clearPendingCommentChips,
} from "@/lib/comment-chat-bridge";

type CommentChip = {
  id: number;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  workspaceId: string;
  sessionId: string | null;
};

const mockGetPending = getPendingCommentChips as ReturnType<typeof vi.fn>;
const mockClearPending = clearPendingCommentChips as ReturnType<typeof vi.fn>;

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

const singleLineChip: CommentChip = {
  id: 1,
  filePath: "src/auth.ts",
  startLine: 42,
  endLine: 42,
  body: "Needs error handling",
  workspaceId: "ws-1",
  sessionId: "session-1",
};

const rangeChip: CommentChip = {
  id: 2,
  filePath: "utils/helpers.ts",
  startLine: 10,
  endLine: 15,
  body: "Refactor this block",
  workspaceId: "ws-1",
  sessionId: "session-1",
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mockGetPending.mockImplementation((_workspaceId: string) => []);
  mockClearPending.mockImplementation((_workspaceId: string) => undefined);
});

afterEach(() => {
  cleanup();
});

describe("PromptInput — comment context chips", () => {
  describe("mount-time hydration from localStorage", () => {
    it("shows a comment chip when localStorage has pending chips on mount", async () => {
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });
    });

    it("clears localStorage after hydrating chips on mount", async () => {
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(mockClearPending).toHaveBeenCalledTimes(1);
      });
    });

    it("shows no comment chips when localStorage is empty on mount", () => {
      mockGetPending.mockReturnValue([]);

      render(<PromptInput {...baseProps} sessionId="fresh-session" />);

      expect(screen.queryByText(/auth\.ts/)).not.toBeInTheDocument();
    });
  });

  describe("same-page CustomEvent pickup", () => {
    it("shows chip when attach-comment-to-chat event fires after mount", async () => {
      mockGetPending.mockReturnValueOnce([]).mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      act(() => {
        window.dispatchEvent(new CustomEvent("attach-comment-to-chat"));
      });

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });
    });

    it("clears localStorage after picking up chip via CustomEvent", async () => {
      mockGetPending.mockReturnValueOnce([]).mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      act(() => {
        window.dispatchEvent(new CustomEvent("attach-comment-to-chat"));
      });

      await waitFor(() => {
        expect(mockClearPending).toHaveBeenCalled();
      });
    });

    it("deduplicates chips with same id when event fires multiple times", async () => {
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      act(() => {
        window.dispatchEvent(new CustomEvent("attach-comment-to-chat"));
      });

      await waitFor(() => {
        const chips = screen.getAllByText(/auth\.ts:42/);
        expect(chips).toHaveLength(1);
      });
    });
  });

  describe("chip display format", () => {
    it("displays single-line chip as filename:line without range", async () => {
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
        expect(screen.queryByText(/auth\.ts:42-42/)).not.toBeInTheDocument();
      });
    });

    it("displays multi-line chip as filename:start-end", async () => {
      mockGetPending.mockReturnValue([rangeChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/helpers\.ts:10-15/)).toBeInTheDocument();
      });
    });

    it("uses basename only in chip label, not full path", async () => {
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
        expect(screen.queryByText(/src\/auth\.ts:42/)).not.toBeInTheDocument();
      });
    });
  });

  describe("chip removal", () => {
    it("removes comment chip when its X button is clicked", async () => {
      const user = userEvent.setup();
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      const removeBtn = screen.getByRole("button", {
        name: /remove comment.*auth\.ts/i,
      });
      await user.click(removeBtn);

      expect(screen.queryByText(/auth\.ts:42/)).not.toBeInTheDocument();
    });

    it("removes only the clicked chip when multiple chips are shown", async () => {
      const user = userEvent.setup();
      mockGetPending.mockReturnValue([singleLineChip, rangeChip]);

      render(<PromptInput {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
        expect(screen.getByText(/helpers\.ts:10-15/)).toBeInTheDocument();
      });

      const removeBtn = screen.getByRole("button", {
        name: /remove comment.*auth\.ts/i,
      });
      await user.click(removeBtn);

      expect(screen.queryByText(/auth\.ts:42/)).not.toBeInTheDocument();
      expect(screen.getByText(/helpers\.ts:10-15/)).toBeInTheDocument();
    });
  });

  describe("submit with comment context", () => {
    it("prepends comment references block before user message", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "fix this");
      await user.keyboard("{Enter}");

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submitted = onSubmit.mock.calls[0][0] as string;
      expect(submitted).toContain("Comment references:");
      expect(submitted).toContain("src/auth.ts:42");
      expect(submitted).toContain("Needs error handling");
      expect(submitted).toContain("[comment:1]");
      expect(submitted).toContain("fix this");
    });

    it("uses full filePath in comment reference text, not basename", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "hello");
      await user.keyboard("{Enter}");

      const submitted = onSubmit.mock.calls[0][0] as string;
      expect(submitted).toContain("src/auth.ts:42");
    });

    it("uses startLine-endLine format for multi-line range in reference text", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([rangeChip]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByText(/helpers\.ts:10-15/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "refactor");
      await user.keyboard("{Enter}");

      const submitted = onSubmit.mock.calls[0][0] as string;
      expect(submitted).toContain("utils/helpers.ts:10-15");
      expect(submitted).toContain("[comment:2]");
    });

    it("places comment context before user message text", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "my question");
      await user.keyboard("{Enter}");

      const submitted = onSubmit.mock.calls[0][0] as string;
      const commentIdx = submitted.indexOf("Comment references:");
      const messageIdx = submitted.indexOf("my question");
      expect(commentIdx).toBeLessThan(messageIdx);
    });

    it("clears comment chips after submit", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([singleLineChip]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument();
      });

      await user.type(screen.getByRole("textbox"), "done");
      await user.keyboard("{Enter}");

      expect(screen.queryByText(/auth\.ts:42/)).not.toBeInTheDocument();
    });

    it("submits plain message without comment prefix when no chips present", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      mockGetPending.mockReturnValue([]);

      render(<PromptInput {...baseProps} onSubmit={onSubmit} />);

      await user.type(screen.getByRole("textbox"), "plain message");
      await user.keyboard("{Enter}");

      const submitted = onSubmit.mock.calls[0][0] as string;
      expect(submitted).not.toContain("Comment references:");
      expect(submitted).toBe("plain message");
    });
  });
});
