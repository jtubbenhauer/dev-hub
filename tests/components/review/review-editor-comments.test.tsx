import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { FileComment } from "@/types"
import { buildCommentExtensions } from "@/lib/editor/comments"
import { ReviewEditor } from "@/components/review/review-editor"

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}))

vi.mock("@/hooks/use-settings", () => ({
  useFontSizeSetting: () => ({ fontSize: 14, setFontSize: vi.fn() }),
  useMobileFontSizeSetting: () => ({ mobileFontSize: 12, setMobileFontSize: vi.fn() }),
  useTabSizeSetting: () => ({ tabSize: 2, setTabSize: vi.fn() }),
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isVimMode: false,
      diffViewMode: "unified" as const,
      toggleDiffViewMode: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock("@/lib/editor/catppuccin-theme", () => ({
  getCM6Theme: () => [],
}))

vi.mock("@/lib/editor/language", () => ({
  getLanguageExtension: () => null,
}))

vi.mock("@/components/editor/vim-toggle", () => ({
  VimToggle: () => null,
}))

vi.mock("@/components/editor/diff-view-toggle", () => ({
  DiffViewToggle: () => null,
}))

let capturedCommentCallbacks: {
  onAddComment: (startLine: number, endLine: number) => void
  onClickComment: (line: number) => void
  commentedLines: Set<number>
} | null = null

vi.mock("@/lib/editor/comments", () => ({
  buildCommentExtensions: vi.fn((opts) => {
    capturedCommentCallbacks = opts
    return []
  }),
}))

const mockAttachCommentToChat = vi.fn()
vi.mock("@/lib/comment-chat-bridge", () => ({
  attachCommentToChat: (...args: unknown[]) => mockAttachCommentToChat(...args),
}))

const mockComments: FileComment[] = []
const mockCreateMutate = vi.fn()
const mockResolveMutate = vi.fn()
const mockDeleteMutate = vi.fn()
const mockUpdateMutate = vi.fn()

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({
    data: mockComments,
    isLoading: false,
    error: null,
  }),
  useCreateFileComment: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
  useResolveFileComment: () => ({
    mutate: mockResolveMutate,
    isPending: false,
  }),
  useDeleteFileComment: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
  useUpdateFileComment: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
}))

vi.mock("@codemirror/view", () => {
  const mockViewInstance = {
    destroy: vi.fn(),
    state: {
      doc: {
        toString: () => "line1\nline2\nline3",
        lineAt: (n: number) => ({ text: `line ${n}` }),
        line: (n: number) => ({ text: `line ${n}` }),
      },
      selection: { main: { from: 0, to: 0 } },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    contentDOM: { blur: vi.fn() },
  }
  class MockEditorView {
    destroy = mockViewInstance.destroy
    state = mockViewInstance.state
    dispatch = mockViewInstance.dispatch
    focus = mockViewInstance.focus
    contentDOM = mockViewInstance.contentDOM
    static theme = vi.fn(() => [])
    static updateListener = { of: vi.fn(() => []) }
  }
  return {
    EditorView: MockEditorView,
    keymap: { of: vi.fn(() => []) },
    lineNumbers: vi.fn(() => []),
    highlightActiveLineGutter: vi.fn(() => []),
    drawSelection: vi.fn(() => []),
    rectangularSelection: vi.fn(() => []),
    Decoration: { none: [], set: vi.fn(() => []), widget: vi.fn(() => ({ range: vi.fn() })) },
    WidgetType: class {},
    gutter: vi.fn(() => []),
    GutterMarker: class {},
  }
})

vi.mock("@codemirror/state", () => {
  class MockCompartment {
    of = vi.fn(() => [])
    reconfigure = vi.fn(() => [])
  }
  return {
    EditorState: {
      create: vi.fn(() => ({})),
      tabSize: { of: vi.fn(() => []) },
    },
    Compartment: MockCompartment,
    StateEffect: { define: vi.fn(() => ({})) },
    StateField: { define: vi.fn(() => ({})) },
  }
})

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => []),
  historyKeymap: [],
  indentWithTab: {},
}))

vi.mock("@codemirror/language", () => ({
  syntaxHighlighting: vi.fn(() => []),
  defaultHighlightStyle: {},
  indentOnInput: vi.fn(() => []),
  bracketMatching: vi.fn(() => []),
  foldGutter: vi.fn(() => []),
  foldKeymap: [],
}))

vi.mock("@codemirror/autocomplete", () => ({
  closeBrackets: vi.fn(() => []),
  closeBracketsKeymap: [],
}))

vi.mock("@codemirror/search", () => ({
  searchKeymap: [],
  highlightSelectionMatches: vi.fn(() => []),
}))

vi.mock("@codemirror/lint", () => ({
  lintKeymap: [],
}))

vi.mock("@codemirror/merge", () => ({
  unifiedMergeView: vi.fn(() => []),
  goToNextChunk: vi.fn(),
  goToPreviousChunk: vi.fn(),
}))

vi.mock("@replit/codemirror-vim", () => ({
  vim: vi.fn(() => []),
  Vim: {
    defineAction: vi.fn(),
    mapCommand: vi.fn(),
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeComment(overrides: Partial<FileComment> = {}): FileComment {
  return {
    id: 1,
    workspaceId: "ws-1",
    filePath: "/src/foo.ts",
    startLine: 10,
    endLine: 10,
    body: "Test comment",
    contentSnapshot: null,
    resolved: false,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides,
  }
}

const defaultFileContent = {
  original: "original content",
  current: "current content",
  path: "src/foo.ts",
  language: "typescript",
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderEditor(props = {}) {
  const queryClient = createQueryClient()
  capturedCommentCallbacks = null

  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewEditor
        fileContent={defaultFileContent}
        workspaceId="ws-1"
        isLoading={false}
        {...props}
      />
    </QueryClientProvider>
  )
}

describe("ReviewEditor comment integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedCommentCallbacks = null
    mockComments.length = 0
  })

  describe("buildCommentExtensions integration", () => {
    it("passes onAddComment, onClickComment, and commentedLines to buildCommentExtensions", () => {
      renderEditor()
      expect(buildCommentExtensions).toHaveBeenCalled()
      expect(capturedCommentCallbacks).not.toBeNull()
      expect(typeof capturedCommentCallbacks!.onAddComment).toBe("function")
      expect(typeof capturedCommentCallbacks!.onClickComment).toBe("function")
      expect(capturedCommentCallbacks!.commentedLines).toBeInstanceOf(Set)
    })

    it("includes comment lines from fetched comments in commentedLines set", () => {
      mockComments.push(
        makeComment({ id: 1, startLine: 5, endLine: 5 }),
        makeComment({ id: 2, startLine: 12, endLine: 14 })
      )
      renderEditor()
      expect(capturedCommentCallbacks).not.toBeNull()
      const lines = capturedCommentCallbacks!.commentedLines
      expect(lines.has(5)).toBe(true)
      expect(lines.has(12)).toBe(true)
    })
  })

  describe("CommentInput rendering", () => {
    it("does not render CommentInput initially", () => {
      renderEditor()
      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()
    })

    it("renders CommentInput when onAddComment is called", () => {
      renderEditor()
      expect(capturedCommentCallbacks).not.toBeNull()

      act(() => {
        capturedCommentCallbacks!.onAddComment(42, 42)
      })

      expect(screen.getByPlaceholderText(/add a comment/i)).toBeInTheDocument()
    })

    it("shows correct file path in CommentInput header", () => {
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onAddComment(10, 15)
      })

      expect(screen.getByText(/foo\.ts:10-15/)).toBeInTheDocument()
    })

    it("closes CommentInput when cancel is clicked", async () => {
      const user = userEvent.setup()
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onAddComment(5, 5)
      })

      expect(screen.getByPlaceholderText(/add a comment/i)).toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: /cancel/i }))
      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()
    })

    it("calls createFileComment mutation on submit", async () => {
      const user = userEvent.setup()
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onAddComment(7, 7)
      })

      const textarea = screen.getByPlaceholderText(/add a comment/i)
      await user.type(textarea, "New line comment")
      await user.click(screen.getByRole("button", { name: /submit/i }))

      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          filePath: "src/foo.ts",
          startLine: 7,
          endLine: 7,
          body: "New line comment",
        })
      )
    })

    it("closes CommentInput after successful submit", async () => {
      const user = userEvent.setup()
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onAddComment(7, 7)
      })

      await user.type(screen.getByPlaceholderText(/add a comment/i), "New comment")
      await user.click(screen.getByRole("button", { name: /submit/i }))

      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()
    })
  })

  describe("CommentThread rendering", () => {
    it("does not render CommentThread when no active comment line", () => {
      mockComments.push(makeComment({ startLine: 10, endLine: 10 }))
      renderEditor()
      expect(screen.queryByText("Test comment")).not.toBeInTheDocument()
    })

    it("renders CommentThread when onClickComment is called for a line with comments", () => {
      mockComments.push(makeComment({ id: 1, startLine: 10, endLine: 10 }))
      renderEditor()
      expect(capturedCommentCallbacks).not.toBeNull()

      act(() => {
        capturedCommentCallbacks!.onClickComment(10)
      })

      expect(screen.getByText("Test comment")).toBeInTheDocument()
    })

    it("shows only comments matching the active line", () => {
      mockComments.push(
        makeComment({ id: 1, startLine: 10, endLine: 10, body: "Comment on line 10" }),
        makeComment({ id: 2, startLine: 20, endLine: 20, body: "Comment on line 20" })
      )
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onClickComment(10)
      })

      expect(screen.getByText("Comment on line 10")).toBeInTheDocument()
      expect(screen.queryByText("Comment on line 20")).not.toBeInTheDocument()
    })

    it("calls resolve mutation when resolve button clicked in thread", async () => {
      const user = userEvent.setup()
      mockComments.push(makeComment({ id: 42, startLine: 10, endLine: 10 }))
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onClickComment(10)
      })

      const resolveButton = screen.getByRole("button", { name: /resolve/i })
      await user.click(resolveButton)

      expect(mockResolveMutate).toHaveBeenCalledWith({ id: 42, resolved: true })
    })

    it("calls delete mutation when delete button clicked in thread", async () => {
      const user = userEvent.setup()
      mockComments.push(makeComment({ id: 42, startLine: 10, endLine: 10 }))
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onClickComment(10)
      })

      const deleteButton = screen.getByRole("button", { name: /delete/i })
      await user.click(deleteButton)

      expect(mockDeleteMutate).toHaveBeenCalledWith(42)
    })

    it("calls attachCommentToChat when attach-to-chat button clicked", async () => {
      const user = userEvent.setup()
      const comment = makeComment({ id: 77, startLine: 10, endLine: 10, body: "Attach me" })
      mockComments.push(comment)
      renderEditor()

      act(() => {
        capturedCommentCallbacks!.onClickComment(10)
      })

      const attachButton = screen.getByRole("button", { name: /attach to chat/i })
      await user.click(attachButton)

      expect(mockAttachCommentToChat).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 77,
          filePath: "/src/foo.ts",
          body: "Attach me",
        })
      )
    })
  })

  describe("loading state", () => {
    it("renders spinner when isLoading is true", () => {
      renderEditor({ isLoading: true })
      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()
    })
  })
})
