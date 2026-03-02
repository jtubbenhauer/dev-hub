"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
} from "@codemirror/view"
import { EditorState, type Extension } from "@codemirror/state"
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
import { githubDark } from "@fsegurai/codemirror-theme-github-dark"
import { unifiedMergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge"
import { vim, Vim } from "@replit/codemirror-vim"
import { Check, ChevronRight, Loader2, Save, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VimToggle } from "@/components/editor/vim-toggle"
import { useEditorStore } from "@/stores/editor-store"
import { useFontSizeSetting, useMobileFontSizeSetting, useTabSizeSetting } from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { getLanguageExtension } from "@/lib/editor/language"
import { toast } from "sonner"
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

export function ReviewEditor({
  fileContent,
  file,
  workspaceId,
  isLoading,
  onToggleReviewed,
  onMarkAndNext,
  onOpenFileList,
}: ReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isVimMode = useEditorStore((s) => s.isVimMode)
  const { fontSize } = useFontSizeSetting()
  const { mobileFontSize } = useMobileFontSizeSetting()
  const { tabSize } = useTabSizeSetting()
  const isMobile = useIsMobile()
  const [isSaving, setIsSaving] = useState(false)

  const currentContentRef = useRef(fileContent.current)
  const workspaceIdRef = useRef(workspaceId)
  const filePathRef = useRef(fileContent.path)

  // Keep refs current without triggering editor rebuilds
  currentContentRef.current = fileContent.current
  workspaceIdRef.current = workspaceId
  filePathRef.current = fileContent.path

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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        githubDark,
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
            backgroundColor: "rgba(46, 160, 67, 0.03)",
            color: "inherit",
            textDecoration: "none",
            padding: "0",
            borderRadius: "0",
          },
          "ins.cm-insertedLine, ins.cm-insertedLine:not(:has(.cm-changedText))": {
            backgroundColor: "rgba(46, 160, 67, 0.03) !important",
            color: "inherit !important",
            textDecoration: "none !important",
            border: "none !important",
            padding: "0 !important",
            borderRadius: "0 !important",
          },
          ".cm-deletedLine": {
            backgroundColor: "rgba(248, 81, 73, 0.03)",
            color: "inherit",
            textDecoration: "none",
            padding: "0",
            borderRadius: "0",
          },
          // The fsegurai `del, del:not(:has(.cm-deletedText))` selector is very broad — match it
          "del.cm-deletedLine, del, del:not(:has(.cm-deletedText))": {
            backgroundColor: "rgba(248, 81, 73, 0.03) !important",
            color: "inherit !important",
            textDecoration: "none !important",
            border: "none !important",
            padding: "0 !important",
            borderRadius: "0 !important",
          },
          // Changed lines (modified but not purely added/removed)
          "&.cm-merge-b .cm-changedLine": { backgroundColor: "rgba(46, 160, 67, 0.02)" },
          "&.cm-merge-a .cm-changedLine": { backgroundColor: "rgba(248, 81, 73, 0.02)" },
          ".cm-deletedChunk": { backgroundColor: "rgba(248, 81, 73, 0.02)" },
          // Word-level inline highlights: slightly more visible than line backgrounds
          "&.cm-merge-b .cm-changedText": { background: "rgba(46, 160, 67, 0.10)" },
          "ins.cm-insertedLine .cm-changedText": { background: "rgba(46, 160, 67, 0.10) !important" },
          "&.cm-merge-b .cm-deletedText": { background: "rgba(248, 81, 73, 0.10)" },
          ".cm-deletedChunk .cm-deletedText": { background: "rgba(248, 81, 73, 0.10)" },
          "del .cm-deletedText, del .cm-changedText": { background: "rgba(248, 81, 73, 0.10) !important" },
          // Gutter change indicators: keep colored but toned down
          ".cm-changedLineGutter": { background: "rgba(46, 160, 67, 0.5)" },
          ".cm-deletedLineGutter": { background: "rgba(248, 81, 73, 0.5)" },
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
    [isVimMode, isMobile, fontSize, mobileFontSize, tabSize, handleSave]
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
    </div>
  )
}
