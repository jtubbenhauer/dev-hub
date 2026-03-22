import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentsSidebar } from "@/components/editor/comments-sidebar";
import type { FileComment } from "@/types";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function makeComment(overrides: Partial<FileComment> = {}): FileComment {
  return {
    id: 1,
    workspaceId: "ws-1",
    filePath: "/src/foo.ts",
    startLine: 10,
    endLine: 10,
    body: "This is a comment",
    contentSnapshot: null,
    resolved: false,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides,
  };
}

const baseHandlers = {
  onScrollToLine: vi.fn(),
  onResolve: vi.fn(),
  onDelete: vi.fn(),
  onUpdate: vi.fn(),
  onAttachToChat: vi.fn(),
  onClose: vi.fn(),
};

describe("CommentsSidebar", () => {
  it("renders list sorted by startLine", () => {
    render(
      <CommentsSidebar
        {...baseHandlers}
        comments={[
          makeComment({ id: 1, startLine: 20, endLine: 20, body: "Line 20" }),
          makeComment({ id: 2, startLine: 5, endLine: 5, body: "Line 5" }),
          makeComment({ id: 3, startLine: 10, endLine: 10, body: "Line 10" }),
        ]}
      />,
    );

    const lineButtons = screen.getAllByRole("button", { name: /go to line/i });
    expect(lineButtons.map((button) => button.textContent)).toEqual([
      "L5",
      "L10",
      "L20",
    ]);
  });

  it("clicking line badge calls onScrollToLine with correct line number", async () => {
    const onScrollToLine = vi.fn();
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        onScrollToLine={onScrollToLine}
        comments={[makeComment({ startLine: 42, endLine: 45 })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /go to line 42/i }));
    expect(onScrollToLine).toHaveBeenCalledWith(42);
  });

  it("resolved comments are hidden by default", () => {
    render(
      <CommentsSidebar
        {...baseHandlers}
        comments={[
          makeComment({ id: 1, body: "Open comment", resolved: false }),
          makeComment({ id: 2, body: "Resolved comment", resolved: true }),
        ]}
      />,
    );

    expect(screen.getByText("Open comment")).toBeInTheDocument();
    expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument();
  });

  it('"Show resolved" toggle reveals resolved comments', async () => {
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        comments={[
          makeComment({ id: 2, body: "Resolved comment", resolved: true }),
        ]}
      />,
    );

    const toggle = screen.getByRole("checkbox", { name: /show resolved/i });
    await user.click(toggle);

    expect(screen.getByText("Resolved comment")).toBeInTheDocument();
  });

  it("resolve callback fires with correct id when resolve button clicked", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        onResolve={onResolve}
        comments={[makeComment({ id: 7 })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /resolve/i }));
    expect(onResolve).toHaveBeenCalledWith(7);
  });

  it("delete callback fires with correct id when delete button clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        onDelete={onDelete}
        comments={[makeComment({ id: 9 })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(9);
  });

  it("attach-to-chat callback fires with correct comment object", async () => {
    const onAttachToChat = vi.fn();
    const user = userEvent.setup();
    const comment = makeComment({ id: 3, body: "Attach me" });

    render(
      <CommentsSidebar
        {...baseHandlers}
        onAttachToChat={onAttachToChat}
        comments={[comment]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /attach to chat/i }));
    expect(onAttachToChat).toHaveBeenCalledWith(comment);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        onClose={onClose}
        comments={[makeComment()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /close comments/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("update callback fires with correct id and body after editing", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();

    render(
      <CommentsSidebar
        {...baseHandlers}
        onUpdate={onUpdate}
        comments={[makeComment({ id: 5, body: "Original body" })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Updated body");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onUpdate).toHaveBeenCalledWith(5, "Updated body");
  });

  it('renders "No comments" when no comments passed', () => {
    render(<CommentsSidebar {...baseHandlers} comments={[]} />);
    expect(screen.getByText("No comments")).toBeInTheDocument();
  });
});
