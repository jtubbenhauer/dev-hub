import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommentThread } from "@/components/editor/comment-thread"
import type { FileComment } from "@/types"

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
  }
}

const baseHandlers = {
  onResolve: vi.fn(),
  onDelete: vi.fn(),
  onUpdate: vi.fn(),
  onAttachToChat: vi.fn(),
}

describe("CommentThread", () => {
  describe("rendering a single unresolved comment", () => {
    it("renders body text", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment()]}
        />
      )
      expect(screen.getByText("This is a comment")).toBeInTheDocument()
    })

    it("renders single-line range as L{n}", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ startLine: 10, endLine: 10 })]}
        />
      )
      expect(screen.getByText("L10")).toBeInTheDocument()
    })

    it("renders multi-line range as L{n}-L{m}", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ startLine: 5, endLine: 12 })]}
        />
      )
      expect(screen.getByText("L5-L12")).toBeInTheDocument()
    })
  })

  describe("resolved comment visibility", () => {
    it("hides resolved comment when showResolved is false (default)", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ resolved: true, body: "Resolved comment" })]}
        />
      )
      expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument()
    })

    it("hides resolved comment when showResolved is explicitly false", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ resolved: true, body: "Resolved comment" })]}
          showResolved={false}
        />
      )
      expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument()
    })

    it("shows resolved comment when showResolved is true", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ resolved: true, body: "Resolved comment" })]}
          showResolved={true}
        />
      )
      expect(screen.getByText("Resolved comment")).toBeInTheDocument()
    })

    it("applies opacity-50 class to resolved comments", () => {
      const { container } = render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ id: 42, resolved: true, body: "Resolved" })]}
          showResolved={true}
        />
      )
      const resolvedItem = container.querySelector(".opacity-50")
      expect(resolvedItem).toBeInTheDocument()
    })
  })

  describe("action buttons", () => {
    it("calls onResolve with correct id when resolve button clicked", async () => {
      const onResolve = vi.fn()
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          onResolve={onResolve}
          comments={[makeComment({ id: 7 })]}
        />
      )
      const resolveButton = screen.getByRole("button", { name: /resolve/i })
      await user.click(resolveButton)
      expect(onResolve).toHaveBeenCalledWith(7)
    })

    it("calls onDelete with correct id when delete button clicked", async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          onDelete={onDelete}
          comments={[makeComment({ id: 9 })]}
        />
      )
      const deleteButton = screen.getByRole("button", { name: /delete/i })
      await user.click(deleteButton)
      expect(onDelete).toHaveBeenCalledWith(9)
    })

    it("calls onAttachToChat with the full comment object", async () => {
      const onAttachToChat = vi.fn()
      const user = userEvent.setup()
      const comment = makeComment({ id: 3, body: "Attach me" })
      render(
        <CommentThread
          {...baseHandlers}
          onAttachToChat={onAttachToChat}
          comments={[comment]}
        />
      )
      const attachButton = screen.getByRole("button", { name: /attach to chat/i })
      await user.click(attachButton)
      expect(onAttachToChat).toHaveBeenCalledWith(comment)
    })
  })

  describe("edit mode", () => {
    it("shows textarea when edit button is clicked", async () => {
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ body: "Original text" })]}
        />
      )
      const editButton = screen.getByRole("button", { name: /edit/i })
      await user.click(editButton)
      const textarea = screen.getByRole("textbox")
      expect(textarea).toBeInTheDocument()
      expect(textarea).toHaveValue("Original text")
    })

    it("calls onUpdate with id and new text when Save is clicked", async () => {
      const onUpdate = vi.fn()
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          onUpdate={onUpdate}
          comments={[makeComment({ id: 5, body: "Old text" })]}
        />
      )
      await user.click(screen.getByRole("button", { name: /edit/i }))
      const textarea = screen.getByRole("textbox")
      await user.clear(textarea)
      await user.type(textarea, "New text")
      await user.click(screen.getByRole("button", { name: /save/i }))
      expect(onUpdate).toHaveBeenCalledWith(5, "New text")
    })

    it("exits edit mode after saving", async () => {
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          comments={[makeComment({ body: "Some text" })]}
        />
      )
      await user.click(screen.getByRole("button", { name: /edit/i }))
      await user.click(screen.getByRole("button", { name: /save/i }))
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
      expect(screen.getByText("Some text")).toBeInTheDocument()
    })

    it("cancels edit and restores original text without calling onUpdate", async () => {
      const onUpdate = vi.fn()
      const user = userEvent.setup()
      render(
        <CommentThread
          {...baseHandlers}
          onUpdate={onUpdate}
          comments={[makeComment({ body: "Original text" })]}
        />
      )
      await user.click(screen.getByRole("button", { name: /edit/i }))
      const textarea = screen.getByRole("textbox")
      await user.clear(textarea)
      await user.type(textarea, "Changed text")
      await user.click(screen.getByRole("button", { name: /cancel/i }))
      expect(onUpdate).not.toHaveBeenCalled()
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })
  })

  describe("multiple comments", () => {
    it("renders all unresolved comments", () => {
      render(
        <CommentThread
          {...baseHandlers}
          comments={[
            makeComment({ id: 1, body: "First comment" }),
            makeComment({ id: 2, body: "Second comment" }),
          ]}
        />
      )
      expect(screen.getByText("First comment")).toBeInTheDocument()
      expect(screen.getByText("Second comment")).toBeInTheDocument()
    })

    it("renders empty state when no comments", () => {
      const { container } = render(
        <CommentThread
          {...baseHandlers}
          comments={[]}
        />
      )
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
