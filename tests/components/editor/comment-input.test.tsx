import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommentInput } from "@/components/editor/comment-input"

const baseProps = {
  startLine: 42,
  endLine: 42,
  filePath: "auth.ts",
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
}

describe("CommentInput", () => {
  describe("header display", () => {
    it("renders single-line header as filename:line", () => {
      render(<CommentInput {...baseProps} startLine={42} endLine={42} />)
      expect(screen.getByText(/auth\.ts:42/)).toBeInTheDocument()
    })

    it("renders multi-line header as filename:startLine-endLine", () => {
      render(<CommentInput {...baseProps} startLine={42} endLine={50} />)
      expect(screen.getByText(/auth\.ts:42-50/)).toBeInTheDocument()
    })
  })

  describe("initialBody prop", () => {
    it("pre-populates textarea with initialBody when provided", () => {
      render(<CommentInput {...baseProps} initialBody="existing text" />)
      expect(screen.getByRole("textbox")).toHaveValue("existing text")
    })

    it("renders empty textarea when initialBody is not provided", () => {
      render(<CommentInput {...baseProps} />)
      expect(screen.getByRole("textbox")).toHaveValue("")
    })
  })

  describe("submit button state", () => {
    it("Submit button is disabled when textarea is empty", () => {
      render(<CommentInput {...baseProps} />)
      const submitButton = screen.getByRole("button", { name: /submit/i })
      expect(submitButton).toBeDisabled()
    })

    it("Submit button is enabled after typing text", async () => {
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} />)
      await user.type(screen.getByRole("textbox"), "hello")
      const submitButton = screen.getByRole("button", { name: /submit/i })
      expect(submitButton).not.toBeDisabled()
    })

    it("Submit button is disabled when body is only whitespace", async () => {
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} />)
      await user.type(screen.getByRole("textbox"), "   ")
      const submitButton = screen.getByRole("button", { name: /submit/i })
      expect(submitButton).toBeDisabled()
    })
  })

  describe("click interactions", () => {
    it("calls onSubmit with typed text when Submit button is clicked", async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} onSubmit={onSubmit} />)
      await user.type(screen.getByRole("textbox"), "my comment")
      await user.click(screen.getByRole("button", { name: /submit/i }))
      expect(onSubmit).toHaveBeenCalledWith("my comment")
    })

    it("calls onCancel when Cancel button is clicked", async () => {
      const onCancel = vi.fn()
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} onCancel={onCancel} />)
      await user.click(screen.getByRole("button", { name: /cancel/i }))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe("keyboard interactions", () => {
    it("calls onSubmit when Enter is pressed in textarea", async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} onSubmit={onSubmit} />)
      const textarea = screen.getByRole("textbox")
      await user.type(textarea, "keyboard submit")
      await user.keyboard("{Enter}")
      expect(onSubmit).toHaveBeenCalledWith("keyboard submit")
    })

    it("does NOT call onSubmit on Shift+Enter, inserts newline instead", async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} onSubmit={onSubmit} />)
      const textarea = screen.getByRole("textbox")
      await user.type(textarea, "line one")
      await user.keyboard("{Shift>}{Enter}{/Shift}")
      expect(onSubmit).not.toHaveBeenCalled()
      expect(textarea).toHaveValue("line one\n")
    })

    it("calls onCancel when Escape is pressed in textarea", async () => {
      const onCancel = vi.fn()
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} onCancel={onCancel} />)
      const textarea = screen.getByRole("textbox")
      await user.click(textarea)
      await user.keyboard("{Escape}")
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe("character count display", () => {
    it("shows 0/2000 when textarea is empty", () => {
      render(<CommentInput {...baseProps} />)
      expect(screen.getByText("0/2000")).toBeInTheDocument()
    })

    it("updates character count as user types", async () => {
      const user = userEvent.setup()
      render(<CommentInput {...baseProps} />)
      await user.type(screen.getByRole("textbox"), "hello")
      expect(screen.getByText("5/2000")).toBeInTheDocument()
    })
  })
})
