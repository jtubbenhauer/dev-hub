"use client";

import {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import { useTheme } from "@/components/providers/theme-provider";
import {
  registerMonacoThemes,
  getMonacoThemeName,
} from "@/lib/editor/monaco-themes";
import {
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
  useCodeLensSetting,
  useMinimapSetting,
} from "@/hooks/use-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useFileComments,
  useCreateFileComment,
  useResolveFileComment,
  useDeleteFileComment,
  useUpdateFileComment,
} from "@/hooks/use-file-comments";
import { CommentsSidebar } from "@/components/editor/comments-sidebar";
import { CommentInput } from "@/components/editor/comment-input";
import { attachCommentToChat } from "@/lib/comment-chat-bridge";
import { useChatStore } from "@/stores/chat-store";
import type { FileComment } from "@/types";
import { MessageCircle } from "lucide-react";
import { useMonacoDiagnosticMarkers } from "@/hooks/use-monaco-diagnostic-markers";
import { useLspEditorAttachment } from "@/hooks/use-lsp-editor-attachment";
import { useBuiltinTypeScriptGate } from "@/lib/lsp/client/use-builtin-typescript-gate";
import { loadMonacoReact } from "@/lib/editor/monaco-bootstrap";
import { registerEditorSaveAction } from "@/components/editor/editor-save-action";
import { registerConfiguredEditorCleanup } from "@/components/editor/configured-editor-lifecycle";
import { useMonacoEditorOptions } from "@/hooks/use-monaco-editor-options";
// prettier-ignore
const Editor = dynamic(
  () => loadMonacoReact().then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

function getMonacoLanguage(language: string): string {
  switch (language) {
    case "typescript":
      return "typescript";
    case "javascript":
      return "javascript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "markdown":
      return "markdown";
    case "python":
      return "python";
    case "rust":
      return "rust";
    case "go":
      return "go";
    case "yaml":
      return "yaml";
    case "shell":
    case "bash":
      return "shell";
    case "sql":
      return "sql";
    case "xml":
      return "xml";
    case "dockerfile":
      return "dockerfile";
    default:
      return "plaintext";
  }
}

export interface MonacoEditorHandle {
  focus: () => void;
  blur: () => void;
  revealLine: (line: number) => void;
}

interface MonacoEditorProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
  isLspEligible?: boolean;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  function MonacoEditor(
    // prettier-ignore
    { content, language, onChange, onSave, workspaceId, filePath, isLspEligible },
    ref,
  ) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const disposeSaveRef = useRef<(() => void) | null>(null);
    useEffect(() => () => disposeSaveRef.current?.(), []);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      blur: () => {
        const dom = editorRef.current?.getDomNode();
        const textarea = dom?.querySelector<HTMLTextAreaElement>("textarea");
        textarea?.blur();
      },
      revealLine: (line: number) => editorRef.current?.revealLineInCenter(line),
    }));

    const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(
      null,
    );
    const commentHighlightRef =
      useRef<editor.IEditorDecorationsCollection | null>(null);
    const { theme, resolvedMode } = useTheme();
    const { fontSize } = useFontSizeSetting();
    const { mobileFontSize } = useMobileFontSizeSetting();
    const { tabSize } = useTabSizeSetting();
    const { isCodeLensEnabled } = useCodeLensSetting();
    const { isMinimapEnabled } = useMinimapSetting();
    const isMobile = useIsMobile();

    const activeSessionId = useChatStore((s) => s.activeSessionId);
    const isCommentMode = !!(workspaceId && filePath);
    const { data: commentsData } = useFileComments(
      workspaceId ?? null,
      filePath,
      true,
    );
    const { mutate: createComment } = useCreateFileComment();
    const { mutate: resolveComment } = useResolveFileComment();
    const { mutate: deleteComment } = useDeleteFileComment();
    const { mutate: updateComment } = useUpdateFileComment();

    const [commentInput, setCommentInput] = useState<{
      startLine: number;
      endLine: number;
      topOffset: number;
    } | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const commentInputRef = useRef<{
      startLine: number;
      endLine: number;
      topOffset: number;
    } | null>(null);

    const commentedLines = useMemo(() => {
      const lines = new Set<number>();
      if (isCommentMode && commentsData) {
        for (const c of commentsData) {
          for (let ln = c.startLine; ln <= c.endLine; ln++) {
            lines.add(ln);
          }
        }
      }
      return lines;
    }, [isCommentMode, commentsData]);

    const onSaveRef = useRef(onSave);
    useEffect(() => {
      onSaveRef.current = onSave;
    });

    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    });

    const commentedLinesRef = useRef(commentedLines);
    useEffect(() => {
      commentedLinesRef.current = commentedLines;
    });

    useEffect(() => {
      commentInputRef.current = commentInput;
    }, [commentInput]);

    useEffect(() => {
      if (!editorRef.current) return;
      if (!commentHighlightRef.current) {
        commentHighlightRef.current =
          editorRef.current.createDecorationsCollection([]);
      }
      if (commentInput) {
        commentHighlightRef.current.set([
          {
            range: {
              startLineNumber: commentInput.startLine,
              startColumn: 1,
              endLineNumber: commentInput.endLine,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: "monaco-comment-highlight",
            },
          },
        ]);
      } else {
        commentHighlightRef.current.clear();
      }
    }, [commentInput]);

    const [isEditorReady, setIsEditorReady] = useState(false);

    useMonacoDiagnosticMarkers(
      monacoRef,
      editorRef,
      workspaceId,
      filePath,
      isEditorReady,
    );
    const lspModelPath = useLspEditorAttachment({
      editorRef,
      monacoRef,
      isEditorReady,
      workspaceId,
      filePath,
      isLspEligible,
      content,
    });

    const { isReady: isBuiltinPolicyReady, prepareMonaco } =
      useBuiltinTypeScriptGate({
        workspaceId,
        filePath,
        isLspEligible,
      });
    const handleBeforeMount = useCallback(
      (monacoInstance: typeof import("monaco-editor")) => {
        prepareMonaco(monacoInstance);
        registerMonacoThemes(monacoInstance);
      },
      [prepareMonaco],
    );

    const handleEditorDidMount = useCallback(
      (
        editorInstance: editor.IStandaloneCodeEditor,
        monacoInstance: typeof import("monaco-editor"),
      ) => {
        editorRef.current = editorInstance;
        monacoRef.current = monacoInstance;
        registerConfiguredEditorCleanup(editorInstance);

        disposeSaveRef.current?.();
        disposeSaveRef.current = registerEditorSaveAction(
          editorInstance,
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
          () => onSaveRef.current?.(),
        );

        if (isCommentMode) {
          decorationsRef.current = editorInstance.createDecorationsCollection(
            [],
          );

          editorInstance.onMouseDown((e) => {
            if (
              e.target.type !==
              monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
            ) {
              if (commentInputRef.current !== null) {
                setCommentInput(null);
              }
              return;
            }

            const lineNumber = e.target.position?.lineNumber;
            if (lineNumber == null) return;

            if (commentedLinesRef.current.has(lineNumber)) {
              setIsSidebarOpen(true);
              setCommentInput(null);
            } else {
              const position = editorRef.current?.getScrolledVisiblePosition({
                lineNumber,
                column: 1,
              });
              if (!position) return;

              const containerHeight =
                editorRef.current?.getDomNode()?.getBoundingClientRect()
                  .height ?? Infinity;
              let topOffset = position.top + position.height;
              if (topOffset + 200 > containerHeight) {
                topOffset = position.top - 200;
              }

              setCommentInput({
                startLine: lineNumber,
                endLine: lineNumber,
                topOffset,
              });
              setIsSidebarOpen(false);
            }
          });

          editorInstance.onDidScrollChange(() => {
            setCommentInput(null);
          });
        }

        setIsEditorReady(true);
      },
      [isCommentMode],
    );

    useEffect(() => {
      if (
        !isEditorReady ||
        !isCommentMode ||
        !decorationsRef.current ||
        !editorRef.current
      )
        return;

      const model = editorRef.current.getModel();
      if (!model) return;

      const lineCount = model.getLineCount();
      const newDecorations: editor.IModelDeltaDecoration[] = [];

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
          });
        } else {
          newDecorations.push({
            range: {
              startLineNumber: ln,
              startColumn: 1,
              endLineNumber: ln,
              endColumn: 1,
            },
            options: { glyphMarginClassName: "monaco-comment-add" },
          });
        }
      }

      decorationsRef.current.set(newDecorations);
    }, [commentedLines, isCommentMode, isEditorReady]);

    const handleChange = useCallback((value: string | undefined) => {
      if (value !== undefined) {
        onChangeRef.current(value);
      }
    }, []);

    function handleCommentSubmit(body: string) {
      if (!workspaceId || !filePath || !commentInput) return;
      const contentSnapshot = editorRef.current?.getValue() ?? null;
      createComment({
        workspaceId,
        filePath,
        startLine: commentInput.startLine,
        endLine: commentInput.endLine,
        body,
        contentSnapshot,
        resolved: false,
      });
      setCommentInput(null);
    }

    const handleScrollToLine = useCallback((line: number) => {
      const editorInstance = editorRef.current;
      if (!editorInstance) return;

      editorInstance.revealLineInCenter(line);
      const highlightDecoration = editorInstance.createDecorationsCollection([
        {
          range: {
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: line,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "monaco-comment-highlight",
          },
        },
      ]);

      setTimeout(() => {
        highlightDecoration.clear();
      }, 1500);
    }, []);

    function handleAttachToChat(comment: FileComment) {
      attachCommentToChat({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        endLine: comment.endLine,
        body: comment.body,
        workspaceId: workspaceId!,
        sessionId: activeSessionId,
      });
    }

    const effectiveFontSize = isMobile ? mobileFontSize : fontSize;
    const options = useMonacoEditorOptions({
      fontSize: effectiveFontSize,
      tabSize,
      isMobile,
      isCommentMode,
      modelPath: lspModelPath,
      isCodeLensEnabled,
      isMinimapEnabled,
    });
    const commentCount = commentsData?.length ?? 0;

    return (
      <div className="flex h-full w-full overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {isBuiltinPolicyReady ? (
            <Editor
              path={lspModelPath}
              height="100%"
              language={getMonacoLanguage(language)}
              theme={getMonacoThemeName(theme, resolvedMode)}
              value={content}
              onChange={handleChange}
              beforeMount={handleBeforeMount}
              onMount={handleEditorDidMount}
              options={options}
            />
          ) : (
            <div className="bg-muted h-full w-full animate-pulse" />
          )}

          {isCommentMode && commentInput && filePath && (
            <div
              className="absolute right-4 left-4 z-20"
              style={{ top: commentInput.topOffset }}
            >
              <CommentInput
                startLine={commentInput.startLine}
                endLine={commentInput.endLine}
                filePath={filePath}
                onSubmit={handleCommentSubmit}
                onCancel={() => setCommentInput(null)}
              />
            </div>
          )}

          {isCommentMode && commentsData && commentsData.length > 0 && (
            <button
              type="button"
              className="bg-background/90 hover:bg-background absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm"
              onClick={() => setIsSidebarOpen((open) => !open)}
              aria-label="Toggle comments"
            >
              <MessageCircle className="size-3.5" />
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                {commentCount}
              </span>
            </button>
          )}
        </div>

        {isCommentMode && isSidebarOpen && commentsData && (
          <div className="w-80 border-l">
            <CommentsSidebar
              comments={commentsData}
              onScrollToLine={handleScrollToLine}
              onResolve={(id) => resolveComment({ id, resolved: true })}
              onDelete={(id) => deleteComment(id)}
              onUpdate={(id, body) => updateComment({ id, body })}
              onAttachToChat={handleAttachToChat}
              onClose={() => setIsSidebarOpen(false)}
            />
          </div>
        )}
      </div>
    );
  },
);
