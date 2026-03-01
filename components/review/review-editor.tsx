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
import { unifiedMergeView } from "@codemirror/merge"
import { vim } from "@replit/codemirror-vim"
import { Check, ChevronRight, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import { getLanguageExtension } from "@/lib/editor/language"
import { toast } from "sonner"
import type { ReviewFile } from "@/types"

interface ReviewEditorProps {
  fileContent: {
    original: string
    current: string
    path: string
    language: string
  }
  file: ReviewFile
  workspaceId: string
  isLoading: boolean
  onToggleReviewed: (file: ReviewFile) => void
  onMarkAndNext: (file: ReviewFile) => void
}

export function ReviewEditor({
  fileContent,
  file,
  workspaceId,
  isLoading,
  onToggleReviewed,
  onMarkAndNext,
}: ReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isVimMode = useEditorStore((s) => s.isVimMode)
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
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": {
            fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace",
          },
          ".cm-gutters": {
            fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace",
          },
        }),
        // Override @codemirror/merge's default diff decorations with subtler background tints.
        // Must include .cm-merge-b to match the specificity of the library's baseTheme.
        // Browser default line-through on <del> tags is handled by globals.css.
        // Override @codemirror/merge's baseTheme diff decorations (dark mode)
        EditorView.theme({
          "&.cm-merge-b .cm-changedText": { background: "rgba(46, 160, 67, 0.05)" },
          "&.cm-merge-b .cm-deletedText": { background: "rgba(248, 81, 73, 0.06)" },
          ".cm-deletedChunk .cm-deletedText": { background: "rgba(248, 81, 73, 0.06)" },
        }, { dark: true }),
        // Light mode overrides (fallback)
        EditorView.theme({
          "&.cm-merge-b .cm-changedText": { background: "rgba(46, 160, 67, 0.08)" },
          "&.cm-merge-b .cm-deletedText": { background: "rgba(248, 81, 73, 0.08)" },
          ".cm-deletedChunk .cm-deletedText": { background: "rgba(248, 81, 73, 0.08)" },
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
    [isVimMode, handleSave]
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
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {fileName}
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>

        <Button
          variant={file.reviewed ? "secondary" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => onToggleReviewed(file)}
        >
          <Check className="h-3.5 w-3.5" />
          {file.reviewed ? "Reviewed" : "Mark reviewed"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => onMarkAndNext(file)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
          Next
        </Button>
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
