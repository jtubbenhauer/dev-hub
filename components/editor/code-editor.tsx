"use client"

import { useEffect, useRef, useCallback } from "react"
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from "@codemirror/view"
import { EditorState, type Extension } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintKeymap } from "@codemirror/lint"
import { githubDark } from "@fsegurai/codemirror-theme-github-dark"
import { vim, Vim } from "@replit/codemirror-vim"
import { useEditorStore } from "@/stores/editor-store"
import { useFontSizeSetting, useTabSizeSetting } from "@/hooks/use-settings"
import { getLanguageExtension } from "@/lib/editor/language"

// Global vim config — runs once
Vim.noremap("jk", "<Esc>", "insert")

interface CodeEditorProps {
  content: string
  language: string
  onChange: (content: string) => void
  onSave?: () => void
}

export function CodeEditor({
  content,
  language,
  onChange,
  onSave,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isVimMode = useEditorStore((s) => s.isVimMode)
  const { fontSize } = useFontSizeSetting()
  const { tabSize } = useTabSizeSetting()

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const buildExtensions = useCallback((): Extension[] => {
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
      highlightActiveLine(),
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
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString())
        }
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current?.()
            return true
          },
        },
      ]),
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: `${fontSize}px`,
        },
        ".cm-scroller": {
          overflow: "auto",
        },
        ".cm-content": {
          fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace",
        },
        ".cm-gutters": {
          fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace",
        },
      }),
      EditorState.tabSize.of(tabSize),
    ]

    if (isVimMode) {
      extensions.unshift(vim())
    }

    const langExt = getLanguageExtension(language)
    if (langExt) {
      extensions.push(langExt)
    }

    return extensions
  }, [isVimMode, language, fontSize, tabSize])

  // Create or recreate the editor when vim mode or language changes
  useEffect(() => {
    if (!editorRef.current) return

    viewRef.current?.destroy()

    const state = EditorState.create({
      doc: content,
      extensions: buildExtensions(),
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // content intentionally excluded — we only want to rebuild on mode/lang changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildExtensions])

  // Sync content from outside without rebuilding the editor
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      })
    }
  }, [content])

  return <div ref={editorRef} className="h-full w-full overflow-hidden" />
}
