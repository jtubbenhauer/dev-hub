import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DiffViewer } from "@/components/git/diff-viewer";
import type { FileComment } from "@/types";

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateFileComment: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useResolveFileComment: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteFileComment: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateFileComment: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/lib/comment-chat-bridge", () => ({
  attachCommentToChat: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  useFileComments,
  useCreateFileComment,
} from "@/hooks/use-file-comments";
import { attachCommentToChat } from "@/lib/comment-chat-bridge";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeComment(overrides: Partial<FileComment> = {}): FileComment {
  return {
    id: 1,
    workspaceId: "ws-1",
    filePath: "src/foo.ts",
    startLine: 3,
    endLine: 3,
    body: "A test comment",
    contentSnapshot: null,
    resolved: false,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides,
  };
}

function fakeQueryResult(data: FileComment[]) {
  return { data, isLoading: false } as unknown as ReturnType<
    typeof useFileComments
  >;
}

const SINGLE_FILE_DIFF = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index abc..def 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,3 +1,4 @@",
  " line one",
  "+line added",
  " line two",
  "-line removed",
].join("\n");

const TWO_FILE_DIFF = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index abc..def 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,2 +1,2 @@",
  " foo context",
  "+foo added",
  "diff --git a/src/bar.ts b/src/bar.ts",
  "index 111..222 100644",
  "--- a/src/bar.ts",
  "+++ b/src/bar.ts",
  "@@ -1,2 +1,2 @@",
  " bar context",
  "+bar added",
].join("\n");

describe("DiffViewer — parseDiffLines filePath extraction", () => {
  it("does NOT show add-comment button without hovering (none visible by default)", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });
    expect(
      screen.queryByRole("button", { name: /add comment/i }),
    ).not.toBeInTheDocument();
  });

  it("renders diff content lines correctly", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line added")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line removed")).toBeInTheDocument();
  });
});

describe("DiffViewer — without workspaceId", () => {
  it("renders diff content without any comment buttons", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} />, { wrapper });
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add comment/i }),
    ).not.toBeInTheDocument();
  });

  it("does not crash without workspaceId", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} />, { wrapper });
    expect(screen.getByText("line one")).toBeInTheDocument();
  });
});

describe("DiffViewer — with workspaceId, hover to add comment", () => {
  beforeEach(() => {
    vi.mocked(useFileComments).mockReturnValue(fakeQueryResult([]));
    vi.mocked(useCreateFileComment).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateFileComment>);
  });

  it("shows '+' add-comment button when hovering a line with filePath", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    const lineRow =
      screen.getByText("line one").closest("[data-diff-line]") ??
      screen.getByText("line one").parentElement!.parentElement!;
    fireEvent.mouseEnter(lineRow);

    expect(
      screen.getByRole("button", { name: /add comment/i }),
    ).toBeInTheDocument();
  });

  it("hides '+' button when mouse leaves the line", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    const lineRow =
      screen.getByText("line one").closest("[data-diff-line]") ??
      screen.getByText("line one").parentElement!.parentElement!;
    fireEvent.mouseEnter(lineRow);
    expect(
      screen.getByRole("button", { name: /add comment/i }),
    ).toBeInTheDocument();

    fireEvent.mouseLeave(lineRow);
    expect(
      screen.queryByRole("button", { name: /add comment/i }),
    ).not.toBeInTheDocument();
  });

  it("opens CommentInput when '+' button is clicked", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    const lineRow =
      screen.getByText("line one").closest("[data-diff-line]") ??
      screen.getByText("line one").parentElement!.parentElement!;
    fireEvent.mouseEnter(lineRow);
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls createFileComment mutation on CommentInput submit", async () => {
    const mutateFn = vi.fn();
    vi.mocked(useCreateFileComment).mockReturnValue({
      mutate: mutateFn,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateFileComment>);

    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    const lineRow =
      screen.getByText("line one").closest("[data-diff-line]") ??
      screen.getByText("line one").parentElement!.parentElement!;
    fireEvent.mouseEnter(lineRow);
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "My new comment" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mutateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          filePath: "src/foo.ts",
          body: "My new comment",
        }),
      );
    });
  });

  it("closes CommentInput when cancel is clicked", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    const lineRow =
      screen.getByText("line one").closest("[data-diff-line]") ??
      screen.getByText("line one").parentElement!.parentElement!;
    fireEvent.mouseEnter(lineRow);
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("DiffViewer — existing comments display", () => {
  it("renders a comment indicator for lines with comments", () => {
    const comment = makeComment({
      filePath: "src/foo.ts",
      startLine: 1,
      endLine: 1,
    });
    vi.mocked(useFileComments).mockReturnValue(fakeQueryResult([comment]));

    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    expect(
      screen.getByRole("button", { name: /view comments/i }),
    ).toBeInTheDocument();
  });

  it("opens CommentThread when comment indicator is clicked", () => {
    const comment = makeComment({
      filePath: "src/foo.ts",
      startLine: 1,
      endLine: 1,
      body: "Existing note",
    });
    vi.mocked(useFileComments).mockReturnValue(fakeQueryResult([comment]));

    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: /view comments/i }));
    expect(screen.getByText("Existing note")).toBeInTheDocument();
  });

  it("calls attachCommentToChat when attach button in thread is clicked", () => {
    const comment = makeComment({
      id: 99,
      filePath: "src/foo.ts",
      startLine: 1,
      endLine: 1,
      body: "Note to attach",
    });
    vi.mocked(useFileComments).mockReturnValue(fakeQueryResult([comment]));
    vi.mocked(useCreateFileComment).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateFileComment>);

    const wrapper = createWrapper();
    render(<DiffViewer diff={SINGLE_FILE_DIFF} workspaceId="ws-1" />, {
      wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: /view comments/i }));
    fireEvent.click(screen.getByRole("button", { name: /attach to chat/i }));

    expect(attachCommentToChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, body: "Note to attach" }),
    );
  });
});

describe("DiffViewer — two-file diff", () => {
  it("renders content from both files", () => {
    const wrapper = createWrapper();
    render(<DiffViewer diff={TWO_FILE_DIFF} workspaceId="ws-1" />, { wrapper });

    expect(screen.getByText("foo context")).toBeInTheDocument();
    expect(screen.getByText("foo added")).toBeInTheDocument();
    expect(screen.getByText("bar context")).toBeInTheDocument();
    expect(screen.getByText("bar added")).toBeInTheDocument();
  });
});
