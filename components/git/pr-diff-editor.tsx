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
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  Decoration,
  type DecorationSet,
  WidgetType,
} from "@codemirror/view"
import { EditorState, type Extension, StateField, StateEffect, RangeSet, Compartment } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintKeymap } from "@codemirror/lint"
import { MergeView, unifiedMergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge"
import { vim, Vim } from "@replit/codemirror-vim"
import { MessageSquare, Send, X, ChevronRight, Loader2, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VimToggle } from "@/components/editor/vim-toggle"
import { DiffViewToggle } from "@/components/editor/diff-view-toggle"
import { useEditorStore } from "@/stores/editor-store"
import { getCM6Theme } from "@/lib/editor/catppuccin-theme"
import { useTheme } from "@/components/providers/theme-provider"
import { useFontSizeSetting, useMobileFontSizeSetting, useTabSizeSetting, useEditorTypeSetting } from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { getLanguageExtension } from "@/lib/editor/language"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types"

const MonacoPrDiffEditor = dynamic(
  () => import("@/components/git/monaco-pr-diff-editor").then((m) => m.MonacoPrDiffEditor),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted" /> }
)

// Register ]c / [c for chunk navigation (runs once at module load)
Vim.defineAction("goToNextChunk", (cm) => {
  goToNextChunk({ state: cm.cm6.state, dispatch: cm.cm6.dispatch.bind(cm.cm6) })
})
Vim.defineAction("goToPreviousChunk", (cm) => {
  goToPreviousChunk({ state: cm.cm6.state, dispatch: cm.cm6.dispatch.bind(cm.cm6) })
})
Vim.mapCommand("]c", "action", "goToNextChunk", {}, { context: "normal" })
Vim.mapCommand("[c", "action", "goToPreviousChunk", {}, { context: "normal" })

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
          <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed">{comment.body}</p>
        </div>
      ))}
      <div className="px-3 py-2">
        <textarea
          value={replyBody}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReplyBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={comments.length > 0 ? "Reply… (Ctrl+Enter to submit)" : "Add a comment… (Ctrl+Enter to submit)"}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>
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

// StateEffect to set the comment widget decorations
const setCommentDecorations = StateEffect.define<DecorationSet>()

const commentDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCommentDecorations)) {
        return effect.value
      }
    }
    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

// Widget that renders a "click to comment" gutter indicator on hover lines
class AddCommentWidget extends WidgetType {
  constructor(private readonly line: number, private readonly onClick: (line: number) => void) {
    super()
  }

  toDOM() {
    const el = document.createElement("button")
    el.className =
      "inline-flex items-center justify-center size-4 rounded text-muted-foreground/40 hover:text-blue-400 hover:bg-blue-400/10 transition-colors ml-1"
    el.setAttribute("title", "Add comment")
    el.setAttribute("aria-label", "Add comment")
    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
    el.addEventListener("mousedown", (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.onClick(this.line)
    })
    return el
  }

  eq(other: AddCommentWidget) {
    return other.line === this.line
  }
}

// Diff colour overrides shared by both view modes
const diffColourOverrides = EditorView.theme({
  "del, del *": { textDecoration: "none !important" },
  ".cm-insertedLine": {
    backgroundColor: "var(--diff-add-line)",
    color: "inherit",
    textDecoration: "none",
  },
  "ins.cm-insertedLine, ins.cm-insertedLine:not(:has(.cm-changedText))": {
    backgroundColor: "var(--diff-add-line) !important",
    color: "inherit !important",
    textDecoration: "none !important",
    border: "none !important",
    padding: "0 !important",
    borderRadius: "0 !important",
  },
  ".cm-deletedLine": {
    backgroundColor: "var(--diff-remove-line)",
    color: "inherit",
    textDecoration: "none",
  },
  "del.cm-deletedLine, del, del:not(:has(.cm-deletedText))": {
    backgroundColor: "var(--diff-remove-line) !important",
    color: "inherit !important",
    textDecoration: "none !important",
    border: "none !important",
    padding: "0 !important",
    borderRadius: "0 !important",
  },
  "&.cm-merge-b .cm-changedLine": { backgroundColor: "var(--diff-add-line)" },
  "&.cm-merge-a .cm-changedLine": { backgroundColor: "var(--diff-remove-line)" },
  ".cm-deletedChunk": { backgroundColor: "var(--diff-remove-line)" },
  "&.cm-merge-b .cm-changedText": { background: "var(--diff-add-bg)" },
  "ins.cm-insertedLine .cm-changedText": { background: "var(--diff-add-bg) !important" },
  "&.cm-merge-b .cm-deletedText": { background: "var(--diff-remove-bg)" },
  ".cm-deletedChunk .cm-deletedText": { background: "var(--diff-remove-bg)" },
  "del .cm-deletedText, del .cm-changedText": { background: "var(--diff-remove-bg) !important" },
  ".cm-changedLineGutter": { background: "var(--diff-add-bg)" },
  ".cm-deletedLineGutter": { background: "var(--diff-remove-bg)" },
})

interface PrDiffEditorProps {
  fileContent: GitHubPrFileContent
  comments: GitHubReviewComment[]
  isLoading: boolean
  isSubmittingComment: boolean
  onAddComment: (body: string, line: number, startLine: number) => Promise<void>
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>
  onOpenFileList?: () => void
}

export const PrDiffEditor = forwardRef<PrDiffEditorHandle, PrDiffEditorProps>(
  function PrDiffEditor(props, ref) {
    const { editorType } = useEditorTypeSetting()

    if (editorType === "monaco") {
      return <MonacoPrDiffEditor ref={ref} {...props} />
    }

    return <CMPrDiffEditor ref={ref} {...props} />
  }
)

const CMPrDiffEditor = forwardRef<PrDiffEditorHandle, PrDiffEditorProps>(
  function CMPrDiffEditor(
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
    const editorRef = useRef<HTMLDivElement>(null)

    // Unified mode refs
    const viewRef = useRef<EditorView | null>(null)
    const themeCompartmentRef = useRef(new Compartment())

    // Side-by-side mode refs
    const mergeViewRef = useRef<MergeView | null>(null)
    const themeCompartmentARef = useRef(new Compartment())
    const themeCompartmentBRef = useRef(new Compartment())

    const diffViewMode = useEditorStore((s) => s.diffViewMode)
    const isVimMode = useEditorStore((s) => s.isVimMode)
    const { theme } = useTheme()
    const { fontSize } = useFontSizeSetting()
    const { mobileFontSize } = useMobileFontSizeSetting()
    const { tabSize } = useTabSizeSetting()
    const isMobile = useIsMobile()

    // Return the active EditorView (panel B in side-by-side, single view in unified)
    const getActiveView = useCallback((): EditorView | null => {
      return mergeViewRef.current?.b ?? viewRef.current ?? null
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => getActiveView()?.focus(),
        blur: () => getActiveView()?.contentDOM.blur(),
      }),
      [getActiveView]
    )

    // Active comment thread: either a line with existing comments, or a new comment position
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

    // Group comments by the line they appear on (use line ?? original_line)
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

    // Build base extensions shared by all panels
    const buildPanelExtensions = useCallback(
      (themeCompartment: Compartment, language: string): Extension[] => {
        const extensions: Extension[] = [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          drawSelection(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          themeCompartment.of(getCM6Theme(theme)),
          EditorState.readOnly.of(true),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: `${isMobile ? mobileFontSize : fontSize}px !important`,
            },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              fontFamily:
                "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
            },
            ".cm-gutters": {
              fontFamily:
                "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
              ...(isMobile ? { fontSize: `${mobileFontSize - 1}px !important` } : {}),
            },
          }),
          EditorState.tabSize.of(tabSize),
          diffColourOverrides,
        ]

        if (isVimMode) {
          extensions.unshift(vim())
        }

        const langExt = getLanguageExtension(language)
        if (langExt) {
          extensions.push(langExt)
        }

        return extensions
      },
      [isVimMode, isMobile, fontSize, mobileFontSize, tabSize, theme]
    )

    // Build comment-related extensions (for the editable / commentable panel)
    const buildCommentExtensions = useCallback(
      (): Extension[] => [
        commentDecorationsField,
        EditorView.domEventHandlers({
          mousemove(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return

            const line = view.state.doc.lineAt(pos)
            const lineNumber = line.number

            const widgets: { from: number; to: number; widget: AddCommentWidget }[] = []
            widgets.push({
              from: line.to,
              to: line.to,
              widget: new AddCommentWidget(lineNumber, handleOpenCommentAt),
            })

            const decorations = RangeSet.of(
              widgets.map(({ from, widget }) =>
                Decoration.widget({ widget, side: 1 }).range(from)
              )
            )

            view.dispatch({ effects: [setCommentDecorations.of(decorations)] })
          },
          mouseleave(_event, view) {
            view.dispatch({ effects: [setCommentDecorations.of(Decoration.none)] })
          },
        }),
      ],
      [handleOpenCommentAt]
    )

    // Cleanup helper
    const destroyEditors = useCallback(() => {
      try { viewRef.current?.destroy() } catch { /* vim cleanup race */ }
      try { mergeViewRef.current?.destroy() } catch { /* vim cleanup race */ }
      viewRef.current = null
      mergeViewRef.current = null
    }, [])

    // Rebuild editor when file, settings, or view mode changes
    useEffect(() => {
      if (!editorRef.current) return

      destroyEditors()

      if (diffViewMode === "unified") {
        const extensions = buildPanelExtensions(themeCompartmentRef.current, fileContent.language)
        extensions.push(
          ...buildCommentExtensions(),
          unifiedMergeView({
            original: fileContent.original,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 3, minSize: 4 },
            mergeControls: false,
          })
        )

        const state = EditorState.create({
          doc: fileContent.current,
          extensions,
        })

        viewRef.current = new EditorView({ state, parent: editorRef.current })
      } else {
        // Side-by-side: original on left, current on right with comment support
        const extA = buildPanelExtensions(themeCompartmentARef.current, fileContent.language)

        const extB = buildPanelExtensions(themeCompartmentBRef.current, fileContent.language)
        extB.push(...buildCommentExtensions())

        mergeViewRef.current = new MergeView({
          a: { doc: fileContent.original, extensions: extA },
          b: { doc: fileContent.current, extensions: extB },
          parent: editorRef.current,
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
        })
      }

      return destroyEditors
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileContent.path, fileContent.language, diffViewMode, buildPanelExtensions, buildCommentExtensions])

    // Hot-swap theme without rebuilding the editor
    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: themeCompartmentRef.current.reconfigure(getCM6Theme(theme)),
        })
      }
      if (mergeViewRef.current) {
        mergeViewRef.current.a.dispatch({
          effects: themeCompartmentARef.current.reconfigure(getCM6Theme(theme)),
        })
        mergeViewRef.current.b.dispatch({
          effects: themeCompartmentBRef.current.reconfigure(getCM6Theme(theme)),
        })
      }
    }, [theme])

    // Sync content changes without full rebuild
    useEffect(() => {
      if (viewRef.current) {
        const currentDoc = viewRef.current.state.doc.toString()
        if (currentDoc !== fileContent.current) {
          viewRef.current.dispatch({
            changes: { from: 0, to: currentDoc.length, insert: fileContent.current },
          })
        }
      }
      if (mergeViewRef.current) {
        const currentDoc = mergeViewRef.current.b.state.doc.toString()
        if (currentDoc !== fileContent.current) {
          mergeViewRef.current.b.dispatch({
            changes: { from: 0, to: currentDoc.length, insert: fileContent.current },
          })
        }
      }
    }, [fileContent.current])

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    const fileName = fileContent.path.split("/").pop() ?? fileContent.path
    const activeCommentThreadComments =
      activeCommentLine !== null ? (commentsByLine.get(activeCommentLine) ?? []) : []
    const existingCommentLines = Array.from(commentsByLine.keys())

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Editor header */}
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

        {/* Existing comment indicators strip */}
        {existingCommentLines.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b bg-muted/10 px-3 py-1.5">
            {existingCommentLines.map((line) => {
              const threadComments = commentsByLine.get(line) ?? []
              return (
                <button
                  key={line}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                    activeCommentLine === line
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() =>
                    setActiveCommentLine((prev) => (prev === line ? null : line))
                  }
                >
                  <MessageSquare className="size-3" />
                  <span>L{line}</span>
                  {threadComments.length > 1 && (
                    <span className="text-muted-foreground">({threadComments.length})</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Active comment thread panel */}
        {activeCommentLine !== null && (
          <div className="shrink-0 border-b max-h-80 overflow-y-auto">
            <CommentThread
              comments={activeCommentThreadComments}
              line={activeCommentLine}
              onReply={onReplyToComment}
              onAddComment={onAddComment}
              onClose={handleCloseComment}
              pendingLine={pendingComment?.line ?? activeCommentLine}
              pendingStartLine={pendingComment?.startLine ?? activeCommentLine}
              isSubmitting={isSubmittingComment}
            />
          </div>
        )}

        {/* New comment button hint */}
        {activeCommentLine === null && (
          <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/5 px-3 py-1 text-[11px] text-muted-foreground/60">
            <MessageSquare className="size-3" />
            <span>Hover a line and click <ChevronRight className="size-3 inline" /> to add a comment</span>
          </div>
        )}

        {/* CodeMirror diff view */}
        <div ref={editorRef} className="min-h-0 flex-1 overflow-hidden [&_.cm-mergeView]:h-full [&_.cm-mergeViewEditor]:h-full" />
      </div>
    )
  }
)
