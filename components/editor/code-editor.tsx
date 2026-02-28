"use client"

import { useEffect, useRef, useCallback } from "react"
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from "@codemirror/view"
import { EditorState, type Extension } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintKeymap } from "@codemirror/lint"
import { oneDark } from "@codemirror/theme-one-dark"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { go } from "@codemirror/lang-go"
import { yaml } from "@codemirror/lang-yaml"
import { vim } from "@replit/codemirror-vim"
import { useEditorStore } from "@/stores/editor-store"

function getLanguageExtension(language: string): Extension | null {
  switch (language) {
    case "typescript":
      return javascript({ typescript: true, jsx: true })
    case "javascript":
      return javascript({ jsx: true })
    case "html":
      return html()
    case "css":
      return css()
    case "json":
      return json()
    case "markdown":
      return markdown()
    case "python":
      return python()
    case "rust":
      return rust()
    case "go":
      return go()
    case "yaml":
      return yaml()
    default:
      return null
  }
}

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
      oneDark,
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
          fontSize: "13px",
        },
        ".cm-scroller": {
          overflow: "auto",
        },
        ".cm-content": {
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        },
        ".cm-gutters": {
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        },
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
  }, [isVimMode, language])

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
