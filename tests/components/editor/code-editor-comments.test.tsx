import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { FileComment } from "@/types"
vi.mock("@codemirror/view", () => ({
  EditorView: class EditorView {
    static updateListener = { of: vi.fn(() => ({})) }
    static theme = vi.fn(() => ({}))
    static lineWrapping = {}
    static domEventHandlers = vi.fn(() => ({}))
    static decorations = { from: vi.fn(() => ({})) }
    constructor() {}
    destroy() {}
    dispatch() {}
    get state() { return { doc: { toString: () => "" } } }
  },
  keymap: { of: vi.fn(() => ({})) },
  lineNumbers: vi.fn(() => ({})),
  highlightActiveLine: vi.fn(() => ({})),
  highlightActiveLineGutter: vi.fn(() => ({})),
  drawSelection: vi.fn(() => ({})),
  rectangularSelection: vi.fn(() => ({})),
  gutter: vi.fn(() => ({})),
  GutterMarker: class GutterMarker {},
  WidgetType: class WidgetType {},
  Decoration: {
    none: {},
    widget: vi.fn(() => ({ range: vi.fn(() => ({})) })),
    set: vi.fn(() => ({})),
  },
}))

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: vi.fn(() => ({})),
    tabSize: { of: vi.fn(() => ({})) },
  },
  Compartment: class Compartment {
    of(ext: unknown) { return ext }
    reconfigure(ext: unknown) { return ext }
  },
  StateEffect: { define: vi.fn(() => ({ is: vi.fn(() => false) })) },
  StateField: { define: vi.fn(() => ({})) },
}))

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => ({})),
  historyKeymap: [],
  indentWithTab: {},
}))

vi.mock("@codemirror/language", () => ({
  syntaxHighlighting: vi.fn(() => ({})),
  defaultHighlightStyle: {},
  indentOnInput: vi.fn(() => ({})),
  bracketMatching: vi.fn(() => ({})),
  foldGutter: vi.fn(() => ({})),
  foldKeymap: [],
}))

vi.mock("@codemirror/autocomplete", () => ({
  closeBrackets: vi.fn(() => ({})),
  closeBracketsKeymap: [],
}))

vi.mock("@codemirror/search", () => ({
  searchKeymap: [],
  highlightSelectionMatches: vi.fn(() => ({})),
}))

vi.mock("@codemirror/lint", () => ({
  lintKeymap: [],
}))

vi.mock("@replit/codemirror-vim", () => ({
  vim: vi.fn(() => ({})),
  Vim: { noremap: vi.fn() },
}))

vi.mock("@/lib/editor/catppuccin-theme", () => ({
  getCM6Theme: vi.fn(() => ({})),
}))

vi.mock("@/lib/editor/language", () => ({
  getLanguageExtension: vi.fn(() => null),
}))

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: vi.fn(() => false),
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: vi.fn(() => ({ theme: "dark" })),
}))

vi.mock("@/hooks/use-settings", () => ({
  useFontSizeSetting: vi.fn(() => ({ fontSize: 14 })),
  useMobileFontSizeSetting: vi.fn(() => ({ mobileFontSize: 16 })),
  useTabSizeSetting: vi.fn(() => ({ tabSize: 2 })),
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}))

type CommentExtensionOptions = {
  onAddComment: (startLine: number, endLine: number) => void
  onClickComment: (line: number) => void
  commentedLines: Set<number>
}

const mockBuildCommentExtensions = vi.fn((_opts: CommentExtensionOptions) => [{}])
vi.mock("@/lib/editor/comments", () => ({
  buildCommentExtensions: (opts: CommentExtensionOptions) => mockBuildCommentExtensions(opts),
}))

const mockCreateMutate = vi.fn()
const mockResolveMutate = vi.fn()
const mockDeleteMutate = vi.fn()

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateFileComment: vi.fn(() => ({ mutate: mockCreateMutate })),
  useResolveFileComment: vi.fn(() => ({ mutate: mockResolveMutate })),
  useDeleteFileComment: vi.fn(() => ({ mutate: mockDeleteMutate })),
  useUpdateFileComment: vi.fn(() => ({ mutate: vi.fn() })),
}))

vi.mock("@/lib/comment-chat-bridge", () => ({
  attachCommentToChat: vi.fn(),
}))

function makeQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeComment(overrides: Partial<FileComment> = {}): FileComment {
  return {
    id: 1,
    workspaceId: "ws-1",
    filePath: "/src/foo.ts",
    startLine: 10,
    endLine: 10,
    body: "A test comment",
    contentSnapshot: null,
    resolved: false,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides,
  }
}

async function importCodeEditor() {
  const mod = await import("@/components/editor/code-editor")
  return mod.CodeEditor
}

describe("CodeEditor — backward compatibility (no comment props)", () => {
  it("renders without workspaceId/filePath and mounts the editor container", async () => {
    const CodeEditor = await importCodeEditor()
    const { container } = render(
      <CodeEditor content="hello" language="typescript" onChange={vi.fn()} />,
      { wrapper: makeQueryClientWrapper() }
    )
    // The editor host div should be present
    expect(container.firstChild).toBeInTheDocument()
  })

  it("does NOT call buildCommentExtensions when workspaceId is absent", async () => {
    mockBuildCommentExtensions.mockClear()
    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor content="hello" language="typescript" onChange={vi.fn()} />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(mockBuildCommentExtensions).not.toHaveBeenCalled()
  })

  it("does NOT call buildCommentExtensions when only workspaceId is provided", async () => {
    mockBuildCommentExtensions.mockClear()
    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
      />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(mockBuildCommentExtensions).not.toHaveBeenCalled()
  })

  it("does NOT call buildCommentExtensions when only filePath is provided", async () => {
    mockBuildCommentExtensions.mockClear()
    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(mockBuildCommentExtensions).not.toHaveBeenCalled()
  })
})

describe("CodeEditor — with workspaceId + filePath (comment mode)", () => {
  it("calls buildCommentExtensions when both workspaceId and filePath are provided", async () => {
    mockBuildCommentExtensions.mockClear()
    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(mockBuildCommentExtensions).toHaveBeenCalledTimes(1)
  })

  it("passes commentedLines, onAddComment, onClickComment to buildCommentExtensions", async () => {
    mockBuildCommentExtensions.mockClear()
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [makeComment({ startLine: 5, endLine: 7 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    expect(mockBuildCommentExtensions).toHaveBeenCalledWith(
      expect.objectContaining({
        onAddComment: expect.any(Function),
        onClickComment: expect.any(Function),
        commentedLines: expect.any(Set),
      })
    )
  })

  it("commentedLines Set contains lines from comments data", async () => {
    mockBuildCommentExtensions.mockClear()
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [
        makeComment({ id: 1, startLine: 3, endLine: 5 }),
        makeComment({ id: 2, startLine: 10, endLine: 10 }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    const callArgs = mockBuildCommentExtensions.mock.calls[0][0] as {
      commentedLines: Set<number>
    }
    // Lines 3,4,5 from first comment + 10 from second
    expect(callArgs.commentedLines.has(3)).toBe(true)
    expect(callArgs.commentedLines.has(4)).toBe(true)
    expect(callArgs.commentedLines.has(5)).toBe(true)
    expect(callArgs.commentedLines.has(10)).toBe(true)
  })

  it("renders CommentInput overlay when onAddComment is triggered", async () => {
    mockBuildCommentExtensions.mockClear()
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    // Retrieve the onAddComment callback and call it
    const { onAddComment } = mockBuildCommentExtensions.mock.calls[0][0] as {
      onAddComment: (s: number, e: number) => void
    }

    act(() => {
      onAddComment(5, 7)
    })

    // CommentInput should appear — look for the Cancel button which is always present
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
    })
  })

  it("dismisses CommentInput overlay when Cancel is clicked", async () => {
    mockBuildCommentExtensions.mockClear()
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    const { onAddComment } = mockBuildCommentExtensions.mock.calls[0][0] as {
      onAddComment: (s: number, e: number) => void
    }

    act(() => { onAddComment(5, 7) })

    const cancelButton = await screen.findByRole("button", { name: /cancel/i })
    const user = userEvent.setup()
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument()
    })
  })

  it("calls createFileComment mutation when CommentInput is submitted", async () => {
    mockBuildCommentExtensions.mockClear()
    mockCreateMutate.mockClear()

    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="line 1\nline 2\nline 3"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    const { onAddComment } = mockBuildCommentExtensions.mock.calls[0][0] as {
      onAddComment: (s: number, e: number) => void
    }
    act(() => { onAddComment(1, 3) })

    const user = userEvent.setup()
    const textarea = await screen.findByRole("textbox")
    await user.type(textarea, "my comment body")
    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          filePath: "/src/foo.ts",
          startLine: 1,
          endLine: 3,
          body: "my comment body",
        })
      )
    })
  })

  it("renders CommentThread when onClickComment is triggered with a commented line", async () => {
    mockBuildCommentExtensions.mockClear()
    const comment = makeComment({ id: 1, startLine: 10, endLine: 10, body: "Thread comment" })

    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [comment],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    const { onClickComment } = mockBuildCommentExtensions.mock.calls[0][0] as {
      onClickComment: (line: number) => void
    }

    act(() => { onClickComment(10) })

    await waitFor(() => {
      expect(screen.getByText("Thread comment")).toBeInTheDocument()
    })
  })

  it("does not show CommentThread before a line is clicked", async () => {
    mockBuildCommentExtensions.mockClear()
    const comment = makeComment({ id: 1, startLine: 10, endLine: 10, body: "Hidden thread" })

    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [comment],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    render(
      <CodeEditor
        content="hello"
        language="typescript"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/src/foo.ts"
      />,
      { wrapper: makeQueryClientWrapper() }
    )

    expect(screen.queryByText("Hidden thread")).not.toBeInTheDocument()
  })
})

describe("CodeEditor — no comments exist", () => {
  it("renders without error when comment list is empty", async () => {
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    const { container } = render(
      <CodeEditor
        content=""
        language="markdown"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/README.md"
      />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it("renders without error when useFileComments returns undefined data", async () => {
    const { useFileComments } = await import("@/hooks/use-file-comments")
    vi.mocked(useFileComments).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useFileComments>)

    const CodeEditor = await importCodeEditor()
    const { container } = render(
      <CodeEditor
        content=""
        language="markdown"
        onChange={vi.fn()}
        workspaceId="ws-1"
        filePath="/README.md"
      />,
      { wrapper: makeQueryClientWrapper() }
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
