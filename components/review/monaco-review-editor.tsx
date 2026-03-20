"use client"

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react"
import dynamic from "next/dynamic"
import type { editor } from "monaco-editor"
import { Check, ChevronRight, Loader2, Save, PanelLeft } from "lucide-react"
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
import { toast } from "sonner"
import {
  useFileComments,
  useCreateFileComment,
  useResolveFileComment,
  useDeleteFileComment,
  useUpdateFileComment,
} from "@/hooks/use-file-comments"
import { CommentThread } from "@/components/editor/comment-thread"
import { CommentInput } from "@/components/editor/comment-input"
import { attachCommentToChat } from "@/lib/comment-chat-bridge"
import { useChatStore } from "@/stores/chat-store"
import type { ReviewFile } from "@/types"

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

export const MonacoReviewEditor = forwardRef<ReviewEditorHandle, ReviewEditorProps>(
  function MonacoReviewEditor(
    {
      fileContent,
      file,
      workspaceId,
      isLoading,
      onToggleReviewed,
      onMarkAndNext,
      onOpenFileList,
    },
    ref
  ) {
    const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
    const monacoRef = useRef<typeof import("monaco-editor") | null>(null)
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)

    const diffViewMode = useEditorStore((s) => s.diffViewMode)
    const { theme, resolvedMode } = useTheme()
    const { fontSize } = useFontSizeSetting()
    const { mobileFontSize } = useMobileFontSizeSetting()
    const { tabSize } = useTabSizeSetting()
    const isMobile = useIsMobile()
    const [isSaving, setIsSaving] = useState(false)
    const [commentInput, setCommentInput] = useState<{
      startLine: number
      endLine: number
    } | null>(null)
    const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
    const [isEditorReady, setIsEditorReady] = useState(false)

    const activeSessionId = useChatStore((s) => s.activeSessionId)
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

    const commentedLinesRef = useRef(commentedLines)
    commentedLinesRef.current = commentedLines

    const currentContentRef = useRef(fileContent.current)
    const workspaceIdRef = useRef(workspaceId)
    const filePathRef = useRef(fileContent.path)
    currentContentRef.current = fileContent.current
    workspaceIdRef.current = workspaceId
    filePathRef.current = fileContent.path

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

    const handleSave = useCallback(async () => {
      const modifiedEditor = getModifiedEditor()
      if (!modifiedEditor) return

      const content = modifiedEditor.getValue()
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
    }, [getModifiedEditor])

    const handleSaveRef = useRef(handleSave)
    handleSaveRef.current = handleSave

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
        monacoRef.current = monacoInstance

        const modifiedEditor = diffEditor.getModifiedEditor()

        modifiedEditor.addCommand(
          // eslint-disable-next-line no-bitwise
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
          () => handleSaveRef.current?.()
        )

        decorationsRef.current = modifiedEditor.createDecorationsCollection([])

        modifiedEditor.onMouseDown((e) => {
          if (
            e.target.type ===
            monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
          ) {
            const lineNumber = e.target.position?.lineNumber
            if (lineNumber == null) return

            if (commentedLinesRef.current.has(lineNumber)) {
              setActiveCommentLine(lineNumber)
              setCommentInput(null)
            } else {
              setCommentInput({ startLine: lineNumber, endLine: lineNumber })
              setActiveCommentLine(null)
            }
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

    const handleCommentSubmit = useCallback(
      (body: string) => {
        if (!commentInput) return
        const modifiedEditor = getModifiedEditor()
        let contentSnapshot: string | null = null
        if (modifiedEditor) {
          try {
            const model = modifiedEditor.getModel()
            if (model) {
              const startLineContent = model.getLineContent(commentInput.startLine)
              const endLineContent = model.getLineContent(commentInput.endLine)
              if (commentInput.startLine === commentInput.endLine) {
                contentSnapshot = startLineContent
              } else {
                const lines: string[] = []
                for (let l = commentInput.startLine; l <= commentInput.endLine; l++) {
                  lines.push(model.getLineContent(l))
                }
                contentSnapshot = lines.join("\n")
              }
            }
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
      },
      [commentInput, workspaceId, fileContent.path, createCommentMutation, getModifiedEditor]
    )

    const handleCommentResolve = useCallback(
      (id: number) => {
        resolveCommentMutation.mutate({ id, resolved: true })
      },
      [resolveCommentMutation]
    )

    const handleCommentDelete = useCallback(
      (id: number) => {
        deleteCommentMutation.mutate(id)
      },
      [deleteCommentMutation]
    )

    const handleCommentUpdate = useCallback(
      (id: number, body: string) => {
        updateCommentMutation.mutate({ id, body })
      },
      [updateCommentMutation]
    )

    const handleAttachToChat = useCallback(
      (comment: {
        id: number
        filePath: string
        startLine: number
        endLine: number
        body: string
      }) => {
        attachCommentToChat({
          ...comment,
          workspaceId,
          sessionId: activeSessionId,
        })
      },
      [workspaceId, activeSessionId]
    )

    const activeComments = useMemo(() => {
      if (activeCommentLine === null || !fileCommentsData) return []
      return fileCommentsData.filter(
        (c) =>
          c.startLine <= activeCommentLine && c.endLine >= activeCommentLine
      )
    }, [activeCommentLine, fileCommentsData])

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    const fileName =
      fileContent.path.split("/").pop() ?? fileContent.path
    const effectiveFontSize = isMobile ? mobileFontSize : fontSize

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 overflow-hidden border-b bg-muted/30 px-2 py-1.5 md:gap-2 md:px-3">
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

          <DiffViewToggle />
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
              <span className="hidden md:inline">
                {file.reviewed ? "Reviewed" : "Mark reviewed"}
              </span>
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
              renderMarginRevertIcon: true,
              originalEditable: false,
              readOnly: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              renderLineHighlight: "line",
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
