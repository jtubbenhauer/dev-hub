"use client"

import { useEffect, useRef, useCallback, useState, useMemo, useImperativeHandle, forwardRef } from "react"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
} from "@codemirror/view"
import { EditorState, type Extension, Compartment } from "@codemirror/state"
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
import { unifiedMergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge"
import { vim, Vim } from "@replit/codemirror-vim"
import { Check, ChevronRight, Loader2, Save, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VimToggle } from "@/components/editor/vim-toggle"
import { useEditorStore } from "@/stores/editor-store"
import { getCM6Theme } from "@/lib/editor/catppuccin-theme"
import { useTheme } from "@/components/providers/theme-provider"
import { useFontSizeSetting, useMobileFontSizeSetting, useTabSizeSetting } from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { getLanguageExtension } from "@/lib/editor/language"
import { toast } from "sonner"
import { buildCommentExtensions } from "@/lib/editor/comments"
import { useFileComments, useCreateFileComment, useResolveFileComment, useDeleteFileComment, useUpdateFileComment } from "@/hooks/use-file-comments"
import { CommentThread } from "@/components/editor/comment-thread"
import { CommentInput } from "@/components/editor/comment-input"
import { attachCommentToChat } from "@/lib/comment-chat-bridge"
import type { ReviewFile } from "@/types"

// Register ]c / [c vim bindings for chunk navigation — runs once at module load
Vim.defineAction("goToNextChunk", (cm) => {
  goToNextChunk({ state: cm.cm6.state, dispatch: cm.cm6.dispatch.bind(cm.cm6) })
})
Vim.defineAction("goToPreviousChunk", (cm) => {
  goToPreviousChunk({ state: cm.cm6.state, dispatch: cm.cm6.dispatch.bind(cm.cm6) })
})
Vim.mapCommand("]c", "action", "goToNextChunk", {}, { context: "normal" })
Vim.mapCommand("[c", "action", "goToPreviousChunk", {}, { context: "normal" })

export interface ReviewEditorHandle {
  focus: () => void
  blur: () => void
}

interface ReviewEditorProps {
  fileContent: {
    original: string
    current: string
    path: string
    language: string
  }
  file?: ReviewFile
  workspaceId: string
  isLoading: boolean
  onToggleReviewed?: (file: ReviewFile) => void
  onMarkAndNext?: (file: ReviewFile) => void
  onOpenFileList?: () => void
}

export const ReviewEditor = forwardRef<ReviewEditorHandle, ReviewEditorProps>(function ReviewEditor({
  fileContent,
  file,
  workspaceId,
  isLoading,
  onToggleReviewed,
  onMarkAndNext,
  onOpenFileList,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const commentCompartmentRef = useRef(new Compartment())

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    blur: () => viewRef.current?.contentDOM.blur(),
  }), [])
  const isVimMode = useEditorStore((s) => s.isVimMode)
  const { theme } = useTheme()
  const { fontSize } = useFontSizeSetting()
  const { mobileFontSize } = useMobileFontSizeSetting()
  const { tabSize } = useTabSizeSetting()
  const isMobile = useIsMobile()
  const [isSaving, setIsSaving] = useState(false)
  const [commentInput, setCommentInput] = useState<{ startLine: number; endLine: number } | null>(null)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)

  const { data: fileCommentsData } = useFileComments(workspaceId, fileContent.path)
  const createCommentMutation = useCreateFileComment()
  const resolveCommentMutation = useResolveFileComment()
  const deleteCommentMutation = useDeleteFileComment()
  const updateCommentMutation = useUpdateFileComment()

  const commentedLines = useMemo(() => {
    const lines = new Set<number>()
    if (fileCommentsData) {
      for (const c of fileCommentsData) {
        for (let l = c.startLine; l <= c.endLine; l++) {
          lines.add(l)
        }
      }
    }
    return lines
  }, [fileCommentsData])

  const currentContentRef = useRef(fileContent.current)
  const workspaceIdRef = useRef(workspaceId)
  const filePathRef = useRef(fileContent.path)

  // Keep refs current without triggering editor rebuilds
  currentContentRef.current = fileContent.current
  workspaceIdRef.current = workspaceId
  filePathRef.current = fileContent.path

  const onAddComment = useCallback((startLine: number, endLine: number) => {
    setCommentInput({ startLine, endLine })
    setActiveCommentLine(null)
  }, [])

  const onClickComment = useCallback((line: number) => {
    setActiveCommentLine(line)
    setCommentInput(null)
  }, [])

  const handleSave = useCallback(async () => {
    const view = viewRef.current
    if (!view) return

    const content = view.state.doc.toString()
    setIsSaving(true)
    try {
      const res = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceIdRef.current,
          path: filePathRef.current,
          content,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Save failed")
      }
      toast.success("Saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed")
    } finally {
      setIsSaving(false)
    }
  }, [])

  const buildExtensions = useCallback(
    (original: string, language: string): Extension[] => {
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
        commentCompartmentRef.current.of(buildCommentExtensions({ onAddComment, onClickComment, commentedLines })),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        themeCompartmentRef.current.of(getCM6Theme(theme)),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...lintKeymap,
          indentWithTab,
          {
            key: "Mod-s",
            run: () => {
              void handleSave()
              return true
            },
          },
        ]),
        unifiedMergeView({
          original,
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
          mergeControls: false,
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: `${isMobile ? mobileFontSize : fontSize}px !important` },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": {
            fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
          },
          ".cm-gutters": {
            fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
            ...(isMobile ? { fontSize: `${mobileFontSize - 1}px !important` } : {}),
          },
        }),
        EditorState.tabSize.of(tabSize),
        // Override @codemirror/merge and @fsegurai/codemirror-theme-github-dark diff decorations.
        // The fsegurai theme applies heavy line-level backgrounds, bright text color changes,
        // strikethrough, and borders — all with !important on <ins>/<del> selectors.
        // We match that specificity here to produce subtle, readable diff indicators.
        EditorView.theme({
          // Kill strikethrough on all <del> elements and their children
          "del, del *": { textDecoration: "none !important" },
          // Line-level backgrounds: very subtle tints, no text color change
          ".cm-insertedLine": {
            backgroundColor: "var(--diff-add-line)",
            color: "inherit",
            textDecoration: "none",
            padding: "0",
            borderRadius: "0",
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
            padding: "0",
            borderRadius: "0",
          },
          // The fsegurai `del, del:not(:has(.cm-deletedText))` selector is very broad — match it
          "del.cm-deletedLine, del, del:not(:has(.cm-deletedText))": {
            backgroundColor: "var(--diff-remove-line) !important",
            color: "inherit !important",
            textDecoration: "none !important",
            border: "none !important",
            padding: "0 !important",
            borderRadius: "0 !important",
          },
          // Changed lines (modified but not purely added/removed)
          "&.cm-merge-b .cm-changedLine": { backgroundColor: "var(--diff-add-line)" },
          "&.cm-merge-a .cm-changedLine": { backgroundColor: "var(--diff-remove-line)" },
          ".cm-deletedChunk": { backgroundColor: "var(--diff-remove-line)" },
          // Word-level inline highlights: slightly more visible than line backgrounds
          "&.cm-merge-b .cm-changedText": { background: "var(--diff-add-bg)" },
          "ins.cm-insertedLine .cm-changedText": { background: "var(--diff-add-bg) !important" },
          "&.cm-merge-b .cm-deletedText": { background: "var(--diff-remove-bg)" },
          ".cm-deletedChunk .cm-deletedText": { background: "var(--diff-remove-bg)" },
          "del .cm-deletedText, del .cm-changedText": { background: "var(--diff-remove-bg) !important" },
          // Gutter change indicators: keep colored but toned down
          ".cm-changedLineGutter": { background: "var(--diff-add-bg)" },
          ".cm-deletedLineGutter": { background: "var(--diff-remove-bg)" },
        }),
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
    [isVimMode, isMobile, fontSize, mobileFontSize, tabSize, handleSave, theme, onAddComment, onClickComment, commentedLines]
  )

  // Rebuild editor when file changes or vim mode toggles
  useEffect(() => {
    if (!editorRef.current) return

    try { viewRef.current?.destroy() } catch { /* vim cleanup race */ }

    const state = EditorState.create({
      doc: fileContent.current,
      extensions: buildExtensions(fileContent.original, fileContent.language),
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      // Wrap destroy in try/catch — @replit/codemirror-vim has a known bug where
      // leaveVimMode nulls cm.state.vim then getOnPasteFn dereferences it.
      try { view.destroy() } catch { /* vim cleanup race */ }
      viewRef.current = null
    }
    // Intentionally depend on path+language as stable identifiers; content changes
    // are handled by sync effect below. Vim mode rebuild is covered by buildExtensions dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent.path, fileContent.language, buildExtensions])

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(getCM6Theme(theme)),
    })
  }, [theme])

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: commentCompartmentRef.current.reconfigure(
        buildCommentExtensions({ onAddComment, onClickComment, commentedLines })
      ),
    })
  }, [commentedLines, onAddComment, onClickComment])

  // Sync content from outside when it changes without a path/language change
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentDoc = view.state.doc.toString()
    if (currentDoc !== fileContent.current) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: fileContent.current },
      })
    }
  }, [fileContent.current])

  const handleCommentSubmit = useCallback((body: string) => {
    if (!commentInput) return
    const view = viewRef.current
    let contentSnapshot: string | null = null
    if (view) {
      try {
        const doc = view.state.doc
        const startLineObj = doc.line(commentInput.startLine)
        const endLineObj = doc.line(commentInput.endLine)
        contentSnapshot = doc.sliceString(startLineObj.from, endLineObj.to)
      } catch {
        contentSnapshot = null
      }
    }
    createCommentMutation.mutate({
      workspaceId,
      filePath: fileContent.path,
      startLine: commentInput.startLine,
      endLine: commentInput.endLine,
      body,
      contentSnapshot,
    })
    setCommentInput(null)
  }, [commentInput, workspaceId, fileContent.path, createCommentMutation])

  const handleCommentResolve = useCallback((id: number) => {
    resolveCommentMutation.mutate({ id, resolved: true })
  }, [resolveCommentMutation])

  const handleCommentDelete = useCallback((id: number) => {
    deleteCommentMutation.mutate(id)
  }, [deleteCommentMutation])

  const handleCommentUpdate = useCallback((id: number, body: string) => {
    updateCommentMutation.mutate({ id, body })
  }, [updateCommentMutation])

  const handleAttachToChat = useCallback((comment: { id: number; filePath: string; startLine: number; endLine: number; body: string }) => {
    attachCommentToChat(comment)
  }, [])

  const activeComments = useMemo(() => {
    if (activeCommentLine === null || !fileCommentsData) return []
    return fileCommentsData.filter(
      (c) => c.startLine <= activeCommentLine && c.endLine >= activeCommentLine
    )
  }, [activeCommentLine, fileCommentsData])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fileName = fileContent.path.split("/").pop() ?? fileContent.path

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Editor header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2 py-1.5 md:gap-2 md:px-3">
        {/* File list toggle - mobile only */}
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

        <VimToggle />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-1.5 text-xs md:px-2"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          <span className="hidden md:inline">Save</span>
        </Button>

        {file && onToggleReviewed && (
          <Button
            variant={file.reviewed ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs md:px-2"
            onClick={() => onToggleReviewed(file)}
          >
            <Check className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{file.reviewed ? "Reviewed" : "Mark reviewed"}</span>
          </Button>
        )}

        {file && onMarkAndNext && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs md:px-2"
            onClick={() => onMarkAndNext(file)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Next</span>
          </Button>
        )}
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} className="min-h-0 flex-1 overflow-hidden" />

      {commentInput && (
        <div className="shrink-0 border-t p-2">
          <CommentInput
            startLine={commentInput.startLine}
            endLine={commentInput.endLine}
            filePath={fileContent.path}
            onSubmit={handleCommentSubmit}
            onCancel={() => setCommentInput(null)}
          />
        </div>
      )}

      {activeCommentLine !== null && activeComments.length > 0 && (
        <div className="shrink-0 border-t p-2">
          <CommentThread
            comments={activeComments}
            onResolve={handleCommentResolve}
            onDelete={handleCommentDelete}
            onUpdate={handleCommentUpdate}
            onAttachToChat={handleAttachToChat}
          />
        </div>
      )}
    </div>
  )
})
