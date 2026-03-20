"use client"

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from "react"
import dynamic from "next/dynamic"
import type { editor } from "monaco-editor"
import { MessageSquare, Send, X, ChevronRight, Loader2, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VimToggle } from "@/components/editor/vim-toggle"
import { DiffViewToggle } from "@/components/editor/diff-view-toggle"
import { useEditorStore } from "@/stores/editor-store"
import { useTheme } from "@/components/providers/theme-provider"
import { registerMonacoThemes, getMonacoThemeName, MONACO_FONT_FAMILY } from "@/lib/editor/monaco-themes"
import {
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
} from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types"

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  }
)

function getMonacoLanguage(language: string): string {
  switch (language) {
    case "typescript":
      return "typescript"
    case "javascript":
      return "javascript"
    case "html":
      return "html"
    case "css":
      return "css"
    case "json":
      return "json"
    case "markdown":
      return "markdown"
    case "python":
      return "python"
    case "rust":
      return "rust"
    case "go":
      return "go"
    case "yaml":
      return "yaml"
    case "shell":
    case "bash":
      return "shell"
    case "sql":
      return "sql"
    case "xml":
      return "xml"
    case "dockerfile":
      return "dockerfile"
    default:
      return "plaintext"
  }
}

export interface PrDiffEditorHandle {
  focus: () => void
  blur: () => void
}

interface PendingComment {
  line: number
  startLine: number
}

interface CommentThreadProps {
  comments: GitHubReviewComment[]
  line: number
  onReply: (body: string, inReplyToId: number) => Promise<void>
  onAddComment: (body: string, line: number, startLine: number) => Promise<void>
  onClose: () => void
  pendingLine: number
  pendingStartLine: number
  isSubmitting: boolean
}

function CommentThread({
  comments,
  onReply,
  onAddComment,
  onClose,
  pendingLine,
  pendingStartLine,
  isSubmitting,
}: CommentThreadProps) {
  const [replyBody, setReplyBody] = useState("")
  const lastCommentId = comments[comments.length - 1]?.id

  const handleSubmit = useCallback(async () => {
    const body = replyBody.trim()
    if (!body) return
    if (lastCommentId !== undefined) {
      await onReply(body, lastCommentId)
    } else {
      await onAddComment(body, pendingLine, pendingStartLine)
    }
    setReplyBody("")
  }, [replyBody, lastCommentId, onReply, onAddComment, pendingLine, pendingStartLine])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSubmit()
      }
      if (e.key === "Escape") {
        onClose()
      }
    },
    [handleSubmit, onClose]
  )

  return (
    <div className="border rounded-md bg-muted/20 text-xs mx-2 my-1 overflow-hidden">
      {comments.map((comment) => (
        <div key={comment.id} className="border-b last:border-b-0 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-medium text-foreground">{comment.user.login}</span>
            <span className="text-muted-foreground">
              {new Date(comment.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed">
            {comment.body}
          </p>
        </div>
      ))}
      <div className="px-3 py-2">
        <textarea
          value={replyBody}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setReplyBody(e.target.value)
          }
          onKeyDown={handleKeyDown}
          placeholder={
            comments.length > 0
              ? "Reply\u2026 (Ctrl+Enter to submit)"
              : "Add a comment\u2026 (Ctrl+Enter to submit)"
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex justify-end gap-1.5 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClose}
          >
            <X className="size-3 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => void handleSubmit()}
            disabled={!replyBody.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="size-3 animate-spin mr-1" />
            ) : (
              <Send className="size-3 mr-1" />
            )}
            {comments.length > 0 ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface PrDiffEditorProps {
  fileContent: GitHubPrFileContent
  comments: GitHubReviewComment[]
  isLoading: boolean
  isSubmittingComment: boolean
  onAddComment: (body: string, line: number, startLine: number) => Promise<void>
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>
  onOpenFileList?: () => void
}

export const MonacoPrDiffEditor = forwardRef<PrDiffEditorHandle, PrDiffEditorProps>(
  function MonacoPrDiffEditor(
    {
      fileContent,
      comments,
      isLoading,
      isSubmittingComment,
      onAddComment,
      onReplyToComment,
      onOpenFileList,
    },
    ref
  ) {
    const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)

    const diffViewMode = useEditorStore((s) => s.diffViewMode)
    const { theme, resolvedMode } = useTheme()
    const { fontSize } = useFontSizeSetting()
    const { mobileFontSize } = useMobileFontSizeSetting()
    const { tabSize } = useTabSizeSetting()
    const isMobile = useIsMobile()
    const [isEditorReady, setIsEditorReady] = useState(false)

    const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
    const [pendingComment, setPendingComment] = useState<PendingComment | null>(null)

    const handleOpenCommentAt = useCallback((line: number) => {
      setActiveCommentLine(line)
      setPendingComment({ line, startLine: line })
    }, [])

    const handleCloseComment = useCallback(() => {
      setActiveCommentLine(null)
      setPendingComment(null)
    }, [])

    const commentsByLine = useMemo(() => {
      const map = new Map<number, GitHubReviewComment[]>()
      for (const comment of comments) {
        const line = comment.line ?? comment.original_line
        if (line === null) continue
        const existing = map.get(line) ?? []
        existing.push(comment)
        map.set(line, existing)
      }
      return map
    }, [comments])

    const commentedLines = useMemo(() => new Set(commentsByLine.keys()), [commentsByLine])
    const commentedLinesRef = useRef(commentedLines)
    commentedLinesRef.current = commentedLines

    const getModifiedEditor = useCallback((): editor.IStandaloneCodeEditor | null => {
      return diffEditorRef.current?.getModifiedEditor() ?? null
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => getModifiedEditor()?.focus(),
        blur: () => getModifiedEditor()?.getDomNode()?.blur(),
      }),
      [getModifiedEditor]
    )

    const handleOpenCommentAtRef = useRef(handleOpenCommentAt)
    handleOpenCommentAtRef.current = handleOpenCommentAt

    const handleBeforeMount = useCallback(
      (monacoInstance: typeof import("monaco-editor")) => {
        registerMonacoThemes(monacoInstance)
      },
      []
    )

    const handleMount = useCallback(
      (
        diffEditor: editor.IStandaloneDiffEditor,
        monacoInstance: typeof import("monaco-editor")
      ) => {
        diffEditorRef.current = diffEditor

        const modifiedEditor = diffEditor.getModifiedEditor()
        decorationsRef.current = modifiedEditor.createDecorationsCollection([])

        modifiedEditor.onMouseDown((e) => {
          if (
            e.target.type ===
            monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
          ) {
            const lineNumber = e.target.position?.lineNumber
            if (lineNumber == null) return
            handleOpenCommentAtRef.current(lineNumber)
          }
        })

        setIsEditorReady(true)
      },
      []
    )

    useEffect(() => {
      if (!isEditorReady || !decorationsRef.current || !diffEditorRef.current)
        return

      const modifiedEditor = diffEditorRef.current.getModifiedEditor()
      const model = modifiedEditor.getModel()
      if (!model) return

      const lineCount = model.getLineCount()
      const newDecorations: editor.IModelDeltaDecoration[] = []

      for (let ln = 1; ln <= lineCount; ln++) {
        if (commentedLines.has(ln)) {
          newDecorations.push({
            range: {
              startLineNumber: ln,
              startColumn: 1,
              endLineNumber: ln,
              endColumn: 1,
            },
            options: { glyphMarginClassName: "monaco-comment-dot" },
          })
        } else {
          newDecorations.push({
            range: {
              startLineNumber: ln,
              startColumn: 1,
              endLineNumber: ln,
              endColumn: 1,
            },
            options: { glyphMarginClassName: "monaco-comment-add" },
          })
        }
      }

      decorationsRef.current.set(newDecorations)
    }, [commentedLines, isEditorReady])

    useEffect(() => {
      if (!diffEditorRef.current) return
      const effectiveFontSize = isMobile ? mobileFontSize : fontSize
      diffEditorRef.current.getOriginalEditor().updateOptions({ fontSize: effectiveFontSize, tabSize })
      diffEditorRef.current.getModifiedEditor().updateOptions({ fontSize: effectiveFontSize, tabSize })
    }, [fontSize, mobileFontSize, tabSize, isMobile])

    useEffect(() => {
      if (!diffEditorRef.current) return
      const modifiedEditor = diffEditorRef.current.getModifiedEditor()
      const model = modifiedEditor.getModel()
      if (!model) return
      if (model.getValue() !== fileContent.current) {
        model.setValue(fileContent.current)
      }
    }, [fileContent.current])

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    const fileName = fileContent.path
    const activeCommentThreadComments =
      activeCommentLine !== null
        ? (commentsByLine.get(activeCommentLine) ?? [])
        : []
    const existingCommentLines = Array.from(commentsByLine.keys())
    const effectiveFontSize = isMobile ? mobileFontSize : fontSize

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2 py-1.5 md:gap-2 md:px-3">
          {onOpenFileList && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 md:hidden"
              onClick={onOpenFileList}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
          )}

          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {fileName}
          </span>

          {existingCommentLines.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="size-3.5" />
              {existingCommentLines.length}
            </span>
          )}

          <DiffViewToggle />
          <VimToggle />
        </div>

        {existingCommentLines.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b bg-muted/10 px-3 py-1.5">
            {existingCommentLines.map((line) => {
              const threadComments = commentsByLine.get(line) ?? []
              return (
                <button
                  type="button"
                  key={line}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                    activeCommentLine === line
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() =>
                    setActiveCommentLine((prev) =>
                      prev === line ? null : line
                    )
                  }
                >
                  <MessageSquare className="size-3" />
                  <span>L{line}</span>
                  {threadComments.length > 1 && (
                    <span className="text-muted-foreground">
                      ({threadComments.length})
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {activeCommentLine !== null && (
          <div className="shrink-0 border-b max-h-80 overflow-y-auto">
            <CommentThread
              comments={activeCommentThreadComments}
              line={activeCommentLine}
              onReply={onReplyToComment}
              onAddComment={onAddComment}
              onClose={handleCloseComment}
              pendingLine={pendingComment?.line ?? activeCommentLine}
              pendingStartLine={
                pendingComment?.startLine ?? activeCommentLine
              }
              isSubmitting={isSubmittingComment}
            />
          </div>
        )}

        {activeCommentLine === null && (
          <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/5 px-3 py-1 text-[11px] text-muted-foreground/60">
            <MessageSquare className="size-3" />
            <span>
              Click the gutter margin to add a comment
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffEditor
            original={fileContent.original}
            modified={fileContent.current}
            language={getMonacoLanguage(fileContent.language)}
            theme={getMonacoThemeName(theme, resolvedMode)}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            options={{
              fontSize: effectiveFontSize,
              lineHeight: Math.round(effectiveFontSize * 1.5),
              fontFamily: MONACO_FONT_FAMILY,
              fontLigatures: false,
              wordWrap: "on",
              renderSideBySide: diffViewMode === "side-by-side",
              hideUnchangedRegions: { enabled: true },
              renderIndicators: true,
              renderMarginRevertIcon: false,
              originalEditable: false,
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              automaticLayout: true,
              glyphMargin: true,
              folding: true,
              smoothScrolling: true,
              padding: { top: 8 },
            }}
          />
        </div>
      </div>
    )
  }
)
