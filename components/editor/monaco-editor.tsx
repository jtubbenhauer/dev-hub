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
  MONACO_FONT_FAMILY,
} from "@/lib/editor/monaco-themes";
import {
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
} from "@/hooks/use-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useFileComments,
  useCreateFileComment,
  useResolveFileComment,
  useDeleteFileComment,
  useUpdateFileComment,
} from "@/hooks/use-file-comments";
import { CommentThread } from "@/components/editor/comment-thread";
import { CommentInput } from "@/components/editor/comment-input";
import { attachCommentToChat } from "@/lib/comment-chat-bridge";
import { useChatStore } from "@/stores/chat-store";

const Editor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
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
}

interface MonacoEditorProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  function MonacoEditor(
    { content, language, onChange, onSave, workspaceId, filePath },
    ref,
  ) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      blur: () => {
        const dom = editorRef.current?.getDomNode();
        const textarea = dom?.querySelector<HTMLTextAreaElement>("textarea");
        textarea?.blur();
      },
    }));

    const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(
      null,
    );
    const { theme, resolvedMode } = useTheme();
    const { fontSize } = useFontSizeSetting();
    const { mobileFontSize } = useMobileFontSizeSetting();
    const { tabSize } = useTabSizeSetting();
    const isMobile = useIsMobile();

    const activeSessionId = useChatStore((s) => s.activeSessionId);
    const isCommentMode = !!(workspaceId && filePath);
    const { data: commentsData } = useFileComments(
      workspaceId ?? null,
      filePath,
    );
    const { mutate: createComment } = useCreateFileComment();
    const { mutate: resolveComment } = useResolveFileComment();
    const { mutate: deleteComment } = useDeleteFileComment();
    const { mutate: updateComment } = useUpdateFileComment();

    const [commentInput, setCommentInput] = useState<{
      startLine: number;
      endLine: number;
    } | null>(null);
    const [activeCommentLine, setActiveCommentLine] = useState<number | null>(
      null,
    );

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

    const lineComments =
      isCommentMode && commentsData && activeCommentLine !== null
        ? commentsData.filter(
            (c) =>
              c.startLine <= activeCommentLine &&
              c.endLine >= activeCommentLine,
          )
        : [];

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

    const [isEditorReady, setIsEditorReady] = useState(false);

    const handleBeforeMount = useCallback(
      (monacoInstance: typeof import("monaco-editor")) => {
        registerMonacoThemes(monacoInstance);
      },
      [],
    );

    const handleEditorDidMount = useCallback(
      (
        editorInstance: editor.IStandaloneCodeEditor,
        monacoInstance: typeof import("monaco-editor"),
      ) => {
        editorRef.current = editorInstance;
        monacoRef.current = monacoInstance;

        editorInstance.addCommand(
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
          () => onSaveRef.current?.(),
        );

        if (isCommentMode) {
          decorationsRef.current = editorInstance.createDecorationsCollection(
            [],
          );

          editorInstance.onMouseDown((e) => {
            if (
              e.target.type ===
              monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
            ) {
              const lineNumber = e.target.position?.lineNumber;
              if (lineNumber == null) return;

              if (commentedLinesRef.current.has(lineNumber)) {
                setActiveCommentLine(lineNumber);
                setCommentInput(null);
              } else {
                setCommentInput({ startLine: lineNumber, endLine: lineNumber });
                setActiveCommentLine(null);
              }
            }
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

    useEffect(() => {
      const editorInstance = editorRef.current;
      if (!editorInstance) return;

      const currentValue = editorInstance.getValue();
      if (currentValue !== content) {
        editorInstance.setValue(content);
      }
    }, [content]);

    useEffect(() => {
      const editorInstance = editorRef.current;
      if (!editorInstance) return;

      editorInstance.updateOptions({
        fontSize: isMobile ? mobileFontSize : fontSize,
        tabSize,
      });
    }, [fontSize, mobileFontSize, tabSize, isMobile]);

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

    const effectiveFontSize = isMobile ? mobileFontSize : fontSize;

    return (
      <div className="relative h-full w-full overflow-hidden">
        <Editor
          height="100%"
          language={getMonacoLanguage(language)}
          theme={getMonacoThemeName(theme, resolvedMode)}
          value={content}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
          onMount={handleEditorDidMount}
          options={{
            fontSize: effectiveFontSize,
            lineHeight: Math.round(effectiveFontSize * 1.5),
            fontFamily: MONACO_FONT_FAMILY,
            fontLigatures: false,
            tabSize,
            minimap: { enabled: !isMobile },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            lineNumbers: "on",
            renderLineHighlight: "line",
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            smoothScrolling: true,
            padding: { top: 8 },
            folding: true,
            foldingStrategy: "indentation",
            glyphMargin: isCommentMode,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: false },
          }}
        />

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

        {isCommentMode &&
          activeCommentLine !== null &&
          lineComments.length > 0 && (
            <div className="absolute top-2 right-2 z-20 w-80">
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
                  });
                  setActiveCommentLine(null);
                }}
              />
            </div>
          )}
      </div>
    );
  },
);
