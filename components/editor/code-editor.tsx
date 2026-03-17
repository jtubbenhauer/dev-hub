"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from "@codemirror/view"
import { EditorState, type Extension, Compartment } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintKeymap } from "@codemirror/lint"
import { vim, Vim } from "@replit/codemirror-vim"
import { useEditorStore } from "@/stores/editor-store"
import { getCM6Theme } from "@/lib/editor/catppuccin-theme"
import { useTheme } from "@/components/providers/theme-provider"
import { useFontSizeSetting, useMobileFontSizeSetting, useTabSizeSetting } from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { getLanguageExtension } from "@/lib/editor/language"
import { buildCommentExtensions } from "@/lib/editor/comments"
import { useFileComments, useCreateFileComment, useResolveFileComment, useDeleteFileComment, useUpdateFileComment } from "@/hooks/use-file-comments"
import { CommentThread } from "@/components/editor/comment-thread"
import { CommentInput } from "@/components/editor/comment-input"
import { attachCommentToChat } from "@/lib/comment-chat-bridge"
import { useChatStore } from "@/stores/chat-store"

Vim.noremap("jk", "<Esc>", "insert")

interface CodeEditorProps {
  content: string
  language: string
  onChange: (content: string) => void
  onSave?: () => void
  workspaceId?: string
  filePath?: string
}

export function CodeEditor({
  content,
  language,
  onChange,
  onSave,
  workspaceId,
  filePath,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const commentCompartmentRef = useRef(new Compartment())
  const isVimMode = useEditorStore((s) => s.isVimMode)
  const { theme } = useTheme()
  const { fontSize } = useFontSizeSetting()
  const { mobileFontSize } = useMobileFontSizeSetting()
  const { tabSize } = useTabSizeSetting()
  const isMobile = useIsMobile()

  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const isCommentMode = !!(workspaceId && filePath)
  const { data: commentsData } = useFileComments(workspaceId ?? null, filePath)
  const { mutate: createComment } = useCreateFileComment()
  const { mutate: resolveComment } = useResolveFileComment()
  const { mutate: deleteComment } = useDeleteFileComment()
  const { mutate: updateComment } = useUpdateFileComment()

  const [commentInput, setCommentInput] = useState<{ startLine: number; endLine: number } | null>(null)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)

  const commentedLines = new Set<number>()
  if (isCommentMode && commentsData) {
    for (const c of commentsData) {
      for (let ln = c.startLine; ln <= c.endLine; ln++) {
        commentedLines.add(ln)
      }
    }
  }

  const lineComments = isCommentMode && commentsData && activeCommentLine !== null
    ? commentsData.filter((c) => c.startLine <= activeCommentLine && c.endLine >= activeCommentLine)
    : []

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
      themeCompartmentRef.current.of(getCM6Theme(theme)),
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
          fontSize: `${isMobile ? mobileFontSize : fontSize}px !important`,
        },
        ".cm-scroller": {
          overflow: "auto",
        },
        ".cm-content": {
          fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
        },
        ".cm-gutters": {
          fontFamily: "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace !important",
        },
      }),
      EditorState.tabSize.of(tabSize),
      EditorView.lineWrapping,
    ]

    if (isVimMode) {
      extensions.unshift(vim())
    }

    const langExt = getLanguageExtension(language)
    if (langExt) {
      extensions.push(langExt)
    }

    if (isCommentMode) {
      extensions.push(commentCompartmentRef.current.of([]))
    }

    return extensions
  }, [isVimMode, language, fontSize, mobileFontSize, isMobile, tabSize, theme, isCommentMode])

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

  // Reconfigure theme dynamically without rebuilding the editor
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(getCM6Theme(theme)),
    })
  }, [theme])

  useEffect(() => {
    if (!viewRef.current || !isCommentMode) return
    viewRef.current.dispatch({
      effects: commentCompartmentRef.current.reconfigure(
        buildCommentExtensions({
          onAddComment: (startLine, endLine) => setCommentInput({ startLine, endLine }),
          onClickComment: (line) => setActiveCommentLine(line),
          commentedLines,
        })
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsData, isCommentMode])

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

  function handleCommentSubmit(body: string) {
    if (!workspaceId || !filePath || !commentInput) return
    const contentSnapshot = viewRef.current?.state.doc.toString() ?? null
    createComment({
      workspaceId,
      filePath,
      startLine: commentInput.startLine,
      endLine: commentInput.endLine,
      body,
      contentSnapshot,
      resolved: false,
    })
    setCommentInput(null)
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={editorRef} className="h-full w-full overflow-hidden" />

      {isCommentMode && commentInput && filePath && (
        <div className="absolute bottom-4 left-1/2 z-20 w-96 -translate-x-1/2">
          <CommentInput
            startLine={commentInput.startLine}
            endLine={commentInput.endLine}
            filePath={filePath}
            onSubmit={handleCommentSubmit}
            onCancel={() => setCommentInput(null)}
          />
        </div>
      )}

      {isCommentMode && activeCommentLine !== null && lineComments.length > 0 && (
        <div className="absolute right-2 top-2 z-20 w-80">
          <CommentThread
            comments={lineComments}
            onResolve={(id) => resolveComment({ id, resolved: true })}
            onDelete={(id) => deleteComment(id)}
            onUpdate={(id, body) => updateComment({ id, body })}
            onAttachToChat={(comment) => {
              attachCommentToChat({
                id: comment.id,
                filePath: comment.filePath,
                startLine: comment.startLine,
                endLine: comment.endLine,
                body: comment.body,
                workspaceId: workspaceId!,
                sessionId: activeSessionId,
              })
              setActiveCommentLine(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
