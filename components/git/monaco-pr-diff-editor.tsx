"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import {
  Send,
  X,
  Loader2,
  PanelLeft,
  MessageCircle,
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewToggle } from "@/components/editor/diff-view-toggle";
import { useEditorStore } from "@/stores/editor-store";
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
import { replaceEmoji } from "@/lib/emoji";
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
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

export interface PrDiffEditorHandle {
  focus: () => void;
  blur: () => void;
}

interface PendingComment {
  line: number;
  startLine: number;
  leftOffset: number;
  width: number;
}

interface CommentThreadProps {
  comments: GitHubReviewComment[];
  line: number;
  isResolved: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onReply: (body: string, inReplyToId: number) => Promise<void>;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
  ) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  currentUserLogin: string | null;
  onClose: () => void;
  pendingLine: number;
  pendingStartLine: number;
  isSubmitting: boolean;
}

function CommentThread({
  comments,
  isResolved,
  isCollapsed,
  onToggleCollapse,
  onReply,
  onAddComment,
  onDeleteComment,
  currentUserLogin,
  onClose,
  pendingLine,
  pendingStartLine,
  isSubmitting,
}: CommentThreadProps) {
  const [replyBody, setReplyBody] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const lastCommentId = comments[comments.length - 1]?.id;

  const handleSubmit = useCallback(async () => {
    const body = replyBody.trim();
    if (!body) return;
    if (lastCommentId !== undefined) {
      await onReply(body, lastCommentId);
    } else {
      await onAddComment(body, pendingLine, pendingStartLine);
    }
    setReplyBody("");
  }, [
    replyBody,
    lastCommentId,
    onReply,
    onAddComment,
    pendingLine,
    pendingStartLine,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  return (
    <div className="bg-popover mx-2 my-1 max-h-60 overflow-y-auto rounded-md border text-xs shadow-lg">
      {comments.length > 0 && (
        <button
          type="button"
          className="hover:bg-muted/50 flex w-full items-center gap-1.5 border-b px-3 py-1.5 transition-colors"
          onClick={onToggleCollapse}
        >
          {isResolved && <Check className="size-3 text-green-500" />}
          <span className="text-muted-foreground flex-1 text-left text-[11px]">
            {comments[0].user.login}
            {comments.length > 1 && ` + ${comments.length - 1} more`}
            {isResolved && " · Resolved"}
          </span>
          {isCollapsed ? (
            <ChevronDown className="text-muted-foreground size-3" />
          ) : (
            <ChevronUp className="text-muted-foreground size-3" />
          )}
        </button>
      )}
      {!isCollapsed && (
        <>
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="border-b px-3 py-2 last:border-b-0"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-foreground font-medium">
                  {comment.user.login}
                </span>
                <span className="text-muted-foreground flex-1">
                  {new Date(comment.created_at).toLocaleDateString()}
                </span>
                {currentUserLogin === comment.user.login && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive -mr-1 shrink-0"
                    disabled={deletingId === comment.id}
                    onClick={async () => {
                      setDeletingId(comment.id);
                      try {
                        await onDeleteComment(comment.id);
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                  >
                    {deletingId === comment.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </Button>
                )}
              </div>
              <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {replaceEmoji(comment.body)}
              </p>
            </div>
          ))}
          <div className="px-3 py-2">
            <textarea
              ref={(el) => el?.focus()}
              value={replyBody}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setReplyBody(e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder={
                comments.length > 0
                  ? "Reply\u2026 (Ctrl+Enter to submit)"
                  : "Add a comment\u2026 (Ctrl+Enter to submit)"
              }
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[60px] w-full resize-none rounded-md border px-3 py-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onClose}
              >
                <X className="mr-1 size-3" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void handleSubmit()}
                disabled={!replyBody.trim() || isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Send className="mr-1 size-3" />
                )}
                {comments.length > 0 ? "Reply" : "Comment"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface PrDiffEditorProps {
  fileContent: GitHubPrFileContent;
  comments: GitHubReviewComment[];
  resolvedLines: Set<number>;
  isLoading: boolean;
  isSubmittingComment: boolean;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
  ) => Promise<void>;
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  currentUserLogin: string | null;
  onOpenFileList?: () => void;
}

export const MonacoPrDiffEditor = forwardRef<
  PrDiffEditorHandle,
  PrDiffEditorProps
>(function MonacoPrDiffEditor(
  {
    fileContent,
    comments,
    resolvedLines,
    isLoading,
    isSubmittingComment,
    onAddComment,
    onReplyToComment,
    onDeleteComment,
    currentUserLogin,
    onOpenFileList,
  },
  ref,
) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(
    null,
  );

  const diffViewMode = useEditorStore((s) => s.diffViewMode);
  const { theme, resolvedMode } = useTheme();
  const { fontSize } = useFontSizeSetting();
  const { mobileFontSize } = useMobileFontSizeSetting();
  const { tabSize } = useTabSizeSetting();
  const isMobile = useIsMobile();
  const [isEditorReady, setIsEditorReady] = useState(false);

  const [overlayPositions, setOverlayPositions] = useState<
    Map<number, { top: number; left: number; width: number }>
  >(() => new Map());

  const [newComment, setNewComment] = useState<PendingComment | null>(null);
  const [newCommentTop, setNewCommentTop] = useState<number | null>(null);

  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(
    () => new Set(resolvedLines),
  );

  const [prevFilePath, setPrevFilePath] = useState(fileContent.path);
  if (prevFilePath !== fileContent.path) {
    setPrevFilePath(fileContent.path);
    setNewComment(null);
    setNewCommentTop(null);
    setOverlayPositions(new Map());
    setCollapsedLines(new Set(resolvedLines));
  }

  const handleCloseNewComment = useCallback(() => {
    setNewComment(null);
    setNewCommentTop(null);
  }, []);

  const commentsByLine = useMemo(() => {
    const map = new Map<number, GitHubReviewComment[]>();
    for (const comment of comments) {
      const line = comment.line ?? comment.original_line;
      if (line === null) continue;
      const existing = map.get(line) ?? [];
      existing.push(comment);
      map.set(line, existing);
    }
    return map;
  }, [comments]);

  const commentedLines = useMemo(
    () => new Set(commentsByLine.keys()),
    [commentsByLine],
  );
  const commentedLinesRef = useRef(commentedLines);
  useEffect(() => {
    commentedLinesRef.current = commentedLines;
  });

  const getModifiedEditor =
    useCallback((): editor.IStandaloneCodeEditor | null => {
      return diffEditorRef.current?.getModifiedEditor() ?? null;
    }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => getModifiedEditor()?.focus(),
      blur: () => getModifiedEditor()?.getDomNode()?.blur(),
    }),
    [getModifiedEditor],
  );

  const commentsByLineRef = useRef(commentsByLine);
  const newCommentRef = useRef(newComment);

  const computeModifiedPaneRect = useCallback(() => {
    const me = getModifiedEditor();
    if (!me) return { left: 16, width: 0 };
    const modDom = me.getDomNode();
    const containerDom = editorContainerRef.current;
    if (!modDom || !containerDom) return { left: 16, width: 0 };
    const modRect = modDom.getBoundingClientRect();
    const containerRect = containerDom.getBoundingClientRect();
    return {
      left: modRect.left - containerRect.left,
      width: modRect.width,
    };
  }, [getModifiedEditor]);

  const updateAllPositions = useCallback(() => {
    const me = getModifiedEditor();
    if (!me) return;

    const pane = computeModifiedPaneRect();
    const next = new Map<
      number,
      { top: number; left: number; width: number }
    >();

    for (const line of commentsByLineRef.current.keys()) {
      const pos = me.getScrolledVisiblePosition({
        lineNumber: line,
        column: 1,
      });
      if (pos) {
        next.set(line, { top: pos.top + pos.height, ...pane });
      }
    }
    setOverlayPositions(next);

    const nc = newCommentRef.current;
    if (nc) {
      const pos = me.getScrolledVisiblePosition({
        lineNumber: nc.line,
        column: 1,
      });
      setNewCommentTop(pos ? pos.top + pos.height : null);
    }
  }, [getModifiedEditor, computeModifiedPaneRect]);

  const updateAllPositionsRef = useRef(updateAllPositions);
  useEffect(() => {
    commentsByLineRef.current = commentsByLine;
    newCommentRef.current = newComment;
    updateAllPositionsRef.current = updateAllPositions;
  });

  const handleBeforeMount = useCallback(
    (monacoInstance: typeof import("monaco-editor")) => {
      registerMonacoThemes(monacoInstance);
    },
    [],
  );

  const handleMount = useCallback(
    (
      diffEditor: editor.IStandaloneDiffEditor,
      monacoInstance: typeof import("monaco-editor"),
    ) => {
      diffEditorRef.current = diffEditor;

      const modifiedEditor = diffEditor.getModifiedEditor();
      decorationsRef.current = modifiedEditor.createDecorationsCollection([]);

      modifiedEditor.onMouseDown((e) => {
        if (
          e.target.type !==
          monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          return;
        }

        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber == null) return;
        if (commentsByLineRef.current.has(lineNumber)) return;

        const pane = computeModifiedPaneRect();
        const pos = modifiedEditor.getScrolledVisiblePosition({
          lineNumber,
          column: 1,
        });

        setNewComment({
          line: lineNumber,
          startLine: lineNumber,
          leftOffset: pane.left,
          width: pane.width,
        });
        setNewCommentTop(pos ? pos.top + pos.height : null);
      });

      modifiedEditor.onDidScrollChange(() => {
        updateAllPositionsRef.current();
      });

      setIsEditorReady(true);
    },
    [computeModifiedPaneRect],
  );

  useEffect(() => {
    if (!isEditorReady || !decorationsRef.current || !diffEditorRef.current)
      return;

    const modifiedEditor = diffEditorRef.current.getModifiedEditor();
    const model = modifiedEditor.getModel();
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
  }, [commentedLines, isEditorReady]);

  useEffect(() => {
    if (!isEditorReady) return;
    void commentedLines;
    const id = requestAnimationFrame(() => updateAllPositions());
    return () => cancelAnimationFrame(id);
  }, [isEditorReady, commentedLines, updateAllPositions]);

  useEffect(() => {
    if (!diffEditorRef.current) return;
    const effectiveFontSize = isMobile ? mobileFontSize : fontSize;
    diffEditorRef.current
      .getOriginalEditor()
      .updateOptions({ fontSize: effectiveFontSize, tabSize });
    diffEditorRef.current
      .getModifiedEditor()
      .updateOptions({ fontSize: effectiveFontSize, tabSize });
  }, [fontSize, mobileFontSize, tabSize, isMobile]);

  const currentContent = fileContent.current;

  useEffect(() => {
    if (!diffEditorRef.current) return;
    const modifiedEditor = diffEditorRef.current.getModifiedEditor();
    const model = modifiedEditor.getModel();
    if (!model) return;
    if (model.getValue() !== currentContent) {
      model.setValue(currentContent);
    }
  }, [currentContent]);

  const sortedCommentLines = useMemo(
    () => Array.from(commentsByLine.keys()).sort((a, b) => a - b),
    [commentsByLine],
  );

  const navigateToComment = useCallback(
    (line: number) => {
      const me = getModifiedEditor();
      if (!me) return;
      me.revealLineInCenter(line);
      requestAnimationFrame(() => updateAllPositions());
    },
    [getModifiedEditor, updateAllPositions],
  );

  const [navLine, setNavLine] = useState<number | null>(null);

  const handlePrevComment = useCallback(() => {
    if (sortedCommentLines.length === 0) return;
    const currentLine = navLine ?? Infinity;
    const prev = sortedCommentLines.filter((l) => l < currentLine).pop();
    const target = prev ?? sortedCommentLines[sortedCommentLines.length - 1];
    setNavLine(target);
    navigateToComment(target);
  }, [sortedCommentLines, navLine, navigateToComment]);

  const handleNextComment = useCallback(() => {
    if (sortedCommentLines.length === 0) return;
    const currentLine = navLine ?? -1;
    const next = sortedCommentLines.find((l) => l > currentLine);
    const target = next ?? sortedCommentLines[0];
    setNavLine(target);
    navigateToComment(target);
  }, [sortedCommentLines, navLine, navigateToComment]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const fileName = fileContent.path;
  const commentCount = comments.length;
  const effectiveFontSize = isMobile ? mobileFontSize : fontSize;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-muted/30 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5 md:gap-2 md:px-3">
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

        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
          {fileName}
        </span>

        <DiffViewToggle />

        {commentCount > 0 && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handlePrevComment}
              aria-label="Previous comment"
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <MessageCircle className="size-3.5" />
              {commentCount}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleNextComment}
              aria-label="Next comment"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div
        ref={editorContainerRef}
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        <div className="min-w-0 flex-1 overflow-hidden">
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
              renderMarginRevertIcon: false,
              originalEditable: false,
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              automaticLayout: true,
              glyphMargin: true,
              folding: true,
              smoothScrolling: true,
              padding: { top: 8 },
            }}
          />
        </div>

        {sortedCommentLines.map((line) => {
          const pos = overlayPositions.get(line);
          if (!pos) return null;
          const threadComments = commentsByLine.get(line) ?? [];
          return (
            <div
              key={`thread-${line}`}
              className="absolute z-20"
              style={{
                top: pos.top,
                left: pos.width ? pos.left : 16,
                width: pos.width || undefined,
                right: pos.width ? undefined : 16,
              }}
              onWheel={(e) => {
                const me = getModifiedEditor();
                if (!me) return;
                me.setScrollTop(me.getScrollTop() + e.deltaY);
              }}
            >
              <CommentThread
                comments={threadComments}
                line={line}
                isResolved={resolvedLines.has(line)}
                isCollapsed={collapsedLines.has(line)}
                onToggleCollapse={() => {
                  setCollapsedLines((prev) => {
                    const next = new Set(prev);
                    if (next.has(line)) next.delete(line);
                    else next.add(line);
                    return next;
                  });
                }}
                onReply={onReplyToComment}
                onAddComment={onAddComment}
                onDeleteComment={onDeleteComment}
                currentUserLogin={currentUserLogin}
                onClose={() =>
                  setCollapsedLines((prev) => new Set(prev).add(line))
                }
                pendingLine={line}
                pendingStartLine={line}
                isSubmitting={isSubmittingComment}
              />
            </div>
          );
        })}

        {newComment && newCommentTop !== null && (
          <div
            className="absolute z-20"
            style={{
              top: newCommentTop,
              left: newComment.width ? newComment.leftOffset : 16,
              width: newComment.width || undefined,
              right: newComment.width ? undefined : 16,
            }}
            onWheel={(e) => {
              const me = getModifiedEditor();
              if (!me) return;
              me.setScrollTop(me.getScrollTop() + e.deltaY);
            }}
          >
            <CommentThread
              comments={[]}
              line={newComment.line}
              isResolved={false}
              isCollapsed={false}
              onToggleCollapse={() => {}}
              onReply={onReplyToComment}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              currentUserLogin={currentUserLogin}
              onClose={handleCloseNewComment}
              pendingLine={newComment.line}
              pendingStartLine={newComment.startLine}
              isSubmitting={isSubmittingComment}
            />
          </div>
        )}
      </div>
    </div>
  );
});
