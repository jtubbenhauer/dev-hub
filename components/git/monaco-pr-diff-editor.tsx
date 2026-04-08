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
import { createPortal } from "react-dom";
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
  Pencil,
  Check,
  CheckCircle2,
  CircleDot,
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
import { GitHubMarkdown } from "@/components/git/github-markdown";
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types";
import type { ReviewDraft } from "@/stores/review-draft-store";

type DraftDisplayComment = GitHubReviewComment & {
  isDraft: true;
  draftId: string;
};

type DisplayComment = GitHubReviewComment | DraftDisplayComment;
type DiffCommentSide = "LEFT" | "RIGHT";

interface CommentLineTarget {
  line: number;
  side: DiffCommentSide;
}

function toLineKey(side: DiffCommentSide, line: number): string {
  return `${side}:${line}`;
}

function fromLineKey(key: string): CommentLineTarget | null {
  const [side, lineText] = key.split(":");
  if ((side !== "LEFT" && side !== "RIGHT") || !lineText) {
    return null;
  }
  const line = Number.parseInt(lineText, 10);
  if (!Number.isInteger(line) || line <= 0) {
    return null;
  }
  return { side, line };
}

function isDraftDisplayComment(
  comment: DisplayComment,
): comment is DraftDisplayComment {
  return "isDraft" in comment && comment.isDraft;
}

function getDraftCommentId(draftId: string): number {
  const raw = draftId.replace(/-/g, "").slice(0, 8);
  return -Math.max(Number.parseInt(raw || "1", 16), 1);
}

function buildDraftDisplayComment(draft: ReviewDraft): DraftDisplayComment {
  return {
    id: getDraftCommentId(draft.id),
    body: draft.body,
    path: draft.path,
    line: draft.line,
    start_line: draft.startLine ?? null,
    side: draft.side,
    start_side: draft.startLine !== undefined ? draft.side : null,
    original_line: draft.line,
    original_start_line: draft.startLine ?? null,
    diff_hunk: "",
    commit_id: "",
    original_commit_id: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user: {
      login: "you",
      id: 0,
      avatar_url: "",
      html_url: "",
      name: null,
    },
    html_url: "",
    in_reply_to_id: draft.replyToId,
    isDraft: true,
    draftId: draft.id,
  };
}

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

interface CommentThreadProps {
  comments: DisplayComment[];
  line: number;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onReply: (body: string, inReplyToId: number) => Promise<void>;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
    isInDiffHunk: boolean,
    side: DiffCommentSide,
  ) => Promise<void>;
  onEditComment: (commentId: number, body: string) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  onDeleteDraft: (draftId: string) => void;
  onEditDraft: (draftId: string, body: string) => void;
  onResolveThread: (line: number, resolved: boolean) => void;
  currentUserLogin: string | null;
  onClose: () => void;
  pendingLine: number;
  pendingStartLine: number;
  pendingSide: DiffCommentSide;
  isSubmitting: boolean;
}

function CommentThread({
  comments,
  line,
  isResolved,
  isOutdated,
  isCollapsed,
  onToggleCollapse,
  onReply,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onDeleteDraft,
  onEditDraft,
  onResolveThread,
  currentUserLogin,
  onClose,
  pendingLine,
  pendingStartLine,
  pendingSide,
  isSubmitting,
}: CommentThreadProps) {
  const [replyBody, setReplyBody] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const replyTargetId = useMemo(() => {
    for (let i = comments.length - 1; i >= 0; i--) {
      const comment = comments[i];
      if (!isDraftDisplayComment(comment)) return comment.id;
    }
    return undefined;
  }, [comments]);

  const handleSubmit = useCallback(async () => {
    const body = replyBody.trim();
    if (!body) return;
    if (replyTargetId !== undefined) {
      await onReply(body, replyTargetId);
    } else {
      await onAddComment(
        body,
        pendingLine,
        pendingStartLine,
        true,
        pendingSide,
      );
    }
    setReplyBody("");
  }, [
    replyBody,
    replyTargetId,
    onReply,
    onAddComment,
    pendingLine,
    pendingStartLine,
    pendingSide,
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
    <div className="bg-popover mx-2 my-1 rounded-md border text-xs shadow-lg">
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
            {isOutdated && (
              <span className="ml-1 rounded bg-yellow-500/20 px-1 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                Outdated
              </span>
            )}
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
                {isDraftDisplayComment(comment) && (
                  <span className="rounded bg-yellow-500/20 px-1 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                    Draft
                  </span>
                )}
                <span className="text-muted-foreground flex-1">
                  {new Date(comment.created_at).toLocaleDateString()}
                </span>
                {(isDraftDisplayComment(comment) ||
                  currentUserLogin === comment.user.login) && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-foreground -mr-0.5 shrink-0"
                      onClick={() => {
                        const key = isDraftDisplayComment(comment)
                          ? comment.draftId
                          : String(comment.id);
                        setEditingKey(key);
                        setEditBody(comment.body);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive -mr-1 shrink-0"
                      disabled={
                        isDraftDisplayComment(comment)
                          ? false
                          : deletingId === comment.id
                      }
                      onClick={async () => {
                        if (isDraftDisplayComment(comment)) {
                          onDeleteDraft(comment.draftId);
                          return;
                        }
                        setDeletingId(comment.id);
                        try {
                          await onDeleteComment(comment.id);
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                    >
                      {!isDraftDisplayComment(comment) &&
                      deletingId === comment.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </Button>
                  </>
                )}
              </div>
              {editingKey ===
              (isDraftDisplayComment(comment)
                ? comment.draftId
                : String(comment.id)) ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setEditBody(e.target.value)
                    }
                    className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[60px] w-full resize-none rounded-md border px-3 py-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
                  />
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setEditingKey(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={!editBody.trim()}
                      onClick={async () => {
                        if (isDraftDisplayComment(comment)) {
                          onEditDraft(comment.draftId, editBody.trim());
                        } else {
                          await onEditComment(comment.id, editBody.trim());
                        }
                        setEditingKey(null);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <GitHubMarkdown
                  content={comment.body}
                  className="text-foreground/80"
                />
              )}
            </div>
          ))}
          <div className="px-3 py-2">
            <textarea
              ref={(el) => {
                if (el && !editingKey) setTimeout(() => el.focus(), 0);
              }}
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
              {comments.some((c) => !isDraftDisplayComment(c)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto h-6 px-2 text-xs"
                  onClick={() => onResolveThread(line, !isResolved)}
                >
                  {isResolved ? (
                    <>
                      <CircleDot className="mr-1 size-3" />
                      Unresolve
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1 size-3" />
                      Resolve
                    </>
                  )}
                </Button>
              )}
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

const COLLAPSED_ZONE_HEIGHT = 32;
const EXPANDED_ZONE_HEIGHT = 200;

interface ZoneEntry {
  zoneId: string;
  domNode: HTMLDivElement;
  contentWrapper: HTMLDivElement;
  currentHeight: number;
}

interface PrDiffEditorProps {
  fileContent: GitHubPrFileContent;
  comments: GitHubReviewComment[];
  drafts: ReviewDraft[];
  resolvedLines: Set<number>;
  outdatedLines: Set<number>;
  isLoading: boolean;
  isSubmittingComment: boolean;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
    isInDiffHunk: boolean,
    side: DiffCommentSide,
  ) => Promise<void>;
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>;
  onEditComment: (commentId: number, body: string) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  onDeleteDraft: (draftId: string) => void;
  onEditDraft: (draftId: string, body: string) => void;
  onResolveThread: (line: number, resolved: boolean) => void;
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
    drafts,
    resolvedLines,
    isLoading,
    isSubmittingComment,
    onAddComment,
    onReplyToComment,
    onEditComment,
    onDeleteComment,
    onDeleteDraft,
    onEditDraft,
    onResolveThread,
    outdatedLines,
    currentUserLogin,
    onOpenFileList,
  },
  ref,
) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const decorationsRef = useRef<
    Record<DiffCommentSide, editor.IEditorDecorationsCollection | null>
  >({ LEFT: null, RIGHT: null });

  const diffViewMode = useEditorStore((s) => s.diffViewMode);
  const { theme, resolvedMode } = useTheme();
  const { fontSize } = useFontSizeSetting();
  const { mobileFontSize } = useMobileFontSizeSetting();
  const { tabSize } = useTabSizeSetting();
  const isMobile = useIsMobile();
  const [isEditorReady, setIsEditorReady] = useState(false);

  const zonesRef = useRef<Map<string, ZoneEntry>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [portalTargets, setPortalTargets] = useState<
    Map<string, HTMLDivElement>
  >(() => new Map());

  const [newCommentLine, setNewCommentLine] =
    useState<CommentLineTarget | null>(null);

  const [collapsedLines, setCollapsedLines] = useState<Set<string>>(
    () => new Set(),
  );
  const [prevResolvedLineKeys, setPrevResolvedLineKeys] = useState(
    () => new Set<string>(),
  );

  const [prevFilePath, setPrevFilePath] = useState(fileContent.path);
  if (prevFilePath !== fileContent.path) {
    setPrevFilePath(fileContent.path);
    setNewCommentLine(null);
    setCollapsedLines(new Set());
    setPrevResolvedLineKeys(new Set());
  }

  const commentsByLine = useMemo(() => {
    const map = new Map<string, DisplayComment[]>();
    const effectiveCommentSide = (side: DiffCommentSide): DiffCommentSide => {
      return diffViewMode === "side-by-side" ? side : "RIGHT";
    };
    for (const comment of comments) {
      const line = comment.line ?? comment.original_line;
      if (line === null) continue;
      const side = effectiveCommentSide(comment.side ?? "RIGHT");
      const key = toLineKey(side, line);
      const existing = map.get(key) ?? [];
      existing.push(comment);
      map.set(key, existing);
    }
    for (const draft of drafts) {
      if (draft.line <= 0) continue;
      const side = effectiveCommentSide(draft.side);
      const key = toLineKey(side, draft.line);
      const existing = map.get(key) ?? [];
      existing.push(buildDraftDisplayComment(draft));
      map.set(key, existing);
    }
    return map;
  }, [comments, drafts, diffViewMode]);

  const commentedLineKeys = useMemo(
    () => new Set<string>(commentsByLine.keys()),
    [commentsByLine],
  );
  const commentedLinesBySide = useMemo(() => {
    const bySide: Record<DiffCommentSide, Set<number>> = {
      LEFT: new Set<number>(),
      RIGHT: new Set<number>(),
    };
    for (const lineKey of commentedLineKeys) {
      const target = fromLineKey(lineKey);
      if (!target) continue;
      bySide[target.side].add(target.line);
    }
    return bySide;
  }, [commentedLineKeys]);
  const resolvedLineKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const lineKey of commentedLineKeys) {
      const target = fromLineKey(lineKey);
      if (target && resolvedLines.has(target.line)) {
        keys.add(lineKey);
      }
    }
    return keys;
  }, [commentedLineKeys, resolvedLines]);

  if (resolvedLineKeys !== prevResolvedLineKeys) {
    setPrevResolvedLineKeys(resolvedLineKeys);
    const newKeys: string[] = [];
    for (const key of resolvedLineKeys) {
      if (!prevResolvedLineKeys.has(key)) newKeys.push(key);
    }
    if (newKeys.length > 0) {
      setCollapsedLines((current) => {
        const next = new Set(current);
        for (const key of newKeys) next.add(key);
        return next;
      });
    }
  }

  const commentedLineKeysRef = useRef(commentedLineKeys);
  useEffect(() => {
    commentedLineKeysRef.current = commentedLineKeys;
  });

  const getOriginalEditor =
    useCallback((): editor.IStandaloneCodeEditor | null => {
      return diffEditorRef.current?.getOriginalEditor() ?? null;
    }, []);

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

  const createZoneDomNodes = useCallback(() => {
    const domNode = document.createElement("div");
    domNode.style.zIndex = "10";
    const contentWrapper = document.createElement("div");
    contentWrapper.style.overflow = "visible";
    domNode.appendChild(contentWrapper);
    return { domNode, contentWrapper };
  }, []);

  const syncViewZones = useCallback(
    (
      currentCommentedLineKeys: Set<string>,
      currentCollapsed: Set<string>,
      currentNewCommentLine: CommentLineTarget | null,
    ): boolean => {
      const linesNeedingZonesBySide: Record<DiffCommentSide, Set<number>> = {
        LEFT: new Set(),
        RIGHT: new Set(),
      };
      for (const key of currentCommentedLineKeys) {
        const target = fromLineKey(key);
        if (!target) continue;
        linesNeedingZonesBySide[target.side].add(target.line);
      }
      if (currentNewCommentLine) {
        const key = toLineKey(
          currentNewCommentLine.side,
          currentNewCommentLine.line,
        );
        if (!currentCommentedLineKeys.has(key)) {
          linesNeedingZonesBySide[currentNewCommentLine.side].add(
            currentNewCommentLine.line,
          );
        }
      }

      const zones = zonesRef.current;
      const resizeObserver = resizeObserverRef.current;
      let portalsDirty = false;

      for (const side of ["LEFT", "RIGHT"] as const) {
        const targetEditor =
          side === "LEFT" ? getOriginalEditor() : getModifiedEditor();
        if (!targetEditor) continue;
        const linesNeedingZones = linesNeedingZonesBySide[side];

        targetEditor.changeViewZones((accessor) => {
          for (const [lineKey, entry] of Array.from(zones.entries())) {
            const target = fromLineKey(lineKey);
            if (!target || target.side !== side) continue;
            if (!linesNeedingZones.has(target.line)) {
              resizeObserver?.unobserve(entry.contentWrapper);
              accessor.removeZone(entry.zoneId);
              zones.delete(lineKey);
              portalsDirty = true;
            }
          }

          for (const line of linesNeedingZones) {
            const lineKey = toLineKey(side, line);
            const existing = zones.get(lineKey);

            if (existing) {
              const isCollapsed =
                currentCollapsed.has(lineKey) &&
                currentCommentedLineKeys.has(lineKey);
              const measuredHeight = existing.contentWrapper.scrollHeight;
              const targetHeight = isCollapsed
                ? COLLAPSED_ZONE_HEIGHT
                : Math.max(measuredHeight, EXPANDED_ZONE_HEIGHT);

              if (targetHeight !== existing.currentHeight) {
                accessor.removeZone(existing.zoneId);
                const newId = accessor.addZone({
                  afterLineNumber: line,
                  heightInPx: targetHeight,
                  domNode: existing.domNode,
                  suppressMouseDown: false,
                  showInHiddenAreas: true,
                });
                existing.zoneId = newId;
                existing.currentHeight = targetHeight;
              }
            } else {
              const isCollapsed =
                currentCollapsed.has(lineKey) &&
                currentCommentedLineKeys.has(lineKey);
              const initialHeight = isCollapsed
                ? COLLAPSED_ZONE_HEIGHT
                : EXPANDED_ZONE_HEIGHT;
              const { domNode, contentWrapper } = createZoneDomNodes();
              const zoneId = accessor.addZone({
                afterLineNumber: line,
                heightInPx: initialHeight,
                domNode,
                suppressMouseDown: false,
                showInHiddenAreas: true,
              });
              zones.set(lineKey, {
                zoneId,
                domNode,
                contentWrapper,
                currentHeight: initialHeight,
              });
              resizeObserver?.observe(contentWrapper);
              portalsDirty = true;
            }
          }
        });
      }

      return portalsDirty;
    },
    [getOriginalEditor, getModifiedEditor, createZoneDomNodes],
  );

  const resizeViewZones = useCallback(
    (currentCommentedLines: Set<string>, currentCollapsed: Set<string>) => {
      const zones = zonesRef.current;

      for (const side of ["LEFT", "RIGHT"] as const) {
        const targetEditor =
          side === "LEFT" ? getOriginalEditor() : getModifiedEditor();
        if (!targetEditor) continue;

        targetEditor.changeViewZones((accessor) => {
          for (const [lineKey, existing] of zones) {
            const target = fromLineKey(lineKey);
            if (!target || target.side !== side) continue;
            const isCollapsed =
              currentCollapsed.has(lineKey) &&
              currentCommentedLines.has(lineKey);
            const measuredHeight = existing.contentWrapper.scrollHeight;
            const targetHeight = isCollapsed
              ? COLLAPSED_ZONE_HEIGHT
              : Math.max(measuredHeight, EXPANDED_ZONE_HEIGHT);

            if (targetHeight !== existing.currentHeight) {
              accessor.removeZone(existing.zoneId);
              const newId = accessor.addZone({
                afterLineNumber: target.line,
                heightInPx: targetHeight,
                domNode: existing.domNode,
                suppressMouseDown: false,
                showInHiddenAreas: true,
              });
              existing.zoneId = newId;
              existing.currentHeight = targetHeight;
            }
          }
        });
      }
    },
    [getOriginalEditor, getModifiedEditor],
  );

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

      const originalEditor = diffEditor.getOriginalEditor();
      const modifiedEditor = diffEditor.getModifiedEditor();
      decorationsRef.current.LEFT = originalEditor.createDecorationsCollection(
        [],
      );
      decorationsRef.current.RIGHT = modifiedEditor.createDecorationsCollection(
        [],
      );

      originalEditor.onMouseDown((e) => {
        if (
          e.target.type !==
          monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          return;
        }

        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber == null) return;
        if (commentedLineKeysRef.current.has(toLineKey("LEFT", lineNumber))) {
          return;
        }

        setNewCommentLine({ line: lineNumber, side: "LEFT" });
      });

      modifiedEditor.onMouseDown((e) => {
        if (
          e.target.type !==
          monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          return;
        }

        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber == null) return;
        if (commentedLineKeysRef.current.has(toLineKey("RIGHT", lineNumber))) {
          return;
        }

        setNewCommentLine({ line: lineNumber, side: "RIGHT" });
      });

      setIsEditorReady(true);
    },
    [],
  );

  useEffect(() => {
    if (!isEditorReady) return;
    const portalsDirty = syncViewZones(
      commentedLineKeys,
      collapsedLines,
      newCommentLine,
    );
    if (portalsDirty) {
      const targets = new Map<string, HTMLDivElement>();
      for (const [lineKey, entry] of zonesRef.current) {
        targets.set(lineKey, entry.contentWrapper);
      }
      queueMicrotask(() => setPortalTargets(targets));
    }

    const resizeObserver = resizeObserverRef.current;
    if (resizeObserver) {
      for (const entry of zonesRef.current.values()) {
        resizeObserver.observe(entry.contentWrapper);
      }
    }
  }, [
    isEditorReady,
    commentedLineKeys,
    collapsedLines,
    newCommentLine,
    syncViewZones,
  ]);

  useEffect(() => {
    if (!isEditorReady) return;
    const resizeObserver = new ResizeObserver(() => {
      resizeViewZones(commentedLineKeys, collapsedLines);
    });
    resizeObserverRef.current = resizeObserver;

    for (const entry of zonesRef.current.values()) {
      resizeObserver.observe(entry.contentWrapper);
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeObserverRef.current === resizeObserver) {
        resizeObserverRef.current = null;
      }
    };
  }, [isEditorReady, commentedLineKeys, collapsedLines, resizeViewZones]);

  useEffect(() => {
    if (!isEditorReady || !diffEditorRef.current) return;

    const bySide: Record<
      DiffCommentSide,
      {
        editorInstance: editor.IStandaloneCodeEditor;
        decorationCollection: editor.IEditorDecorationsCollection | null;
      }
    > = {
      LEFT: {
        editorInstance: diffEditorRef.current.getOriginalEditor(),
        decorationCollection: decorationsRef.current.LEFT,
      },
      RIGHT: {
        editorInstance: diffEditorRef.current.getModifiedEditor(),
        decorationCollection: decorationsRef.current.RIGHT,
      },
    };

    for (const side of ["LEFT", "RIGHT"] as const) {
      const { editorInstance, decorationCollection } = bySide[side];
      if (!decorationCollection) continue;
      const model = editorInstance.getModel();
      if (!model) continue;

      const sideCommentedLines = commentedLinesBySide[side];
      const lineCount = model.getLineCount();
      const newDecorations: editor.IModelDeltaDecoration[] = [];

      for (let ln = 1; ln <= lineCount; ln++) {
        if (sideCommentedLines.has(ln)) {
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

      decorationCollection.set(newDecorations);
    }
  }, [commentedLinesBySide, isEditorReady]);

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

  const sortedCommentTargets = useMemo(
    () =>
      Array.from(commentsByLine.keys())
        .map((lineKey) => {
          const target = fromLineKey(lineKey);
          if (!target) return null;
          return { ...target, lineKey };
        })
        .filter((target): target is CommentLineTarget & { lineKey: string } => {
          return target !== null;
        })
        .sort((a, b) => {
          if (a.line !== b.line) return a.line - b.line;
          return a.side.localeCompare(b.side);
        }),
    [commentsByLine],
  );

  const navigateToComment = useCallback(
    (target: CommentLineTarget) => {
      const editorForSide =
        target.side === "LEFT" && diffViewMode === "side-by-side"
          ? getOriginalEditor()
          : getModifiedEditor();
      if (!editorForSide) return;
      editorForSide.revealLineInCenter(target.line);
    },
    [getOriginalEditor, getModifiedEditor, diffViewMode],
  );

  const [navLineKey, setNavLineKey] = useState<string | null>(null);

  const handlePrevComment = useCallback(() => {
    if (sortedCommentTargets.length === 0) return;
    const currentIndex = navLineKey
      ? sortedCommentTargets.findIndex(
          (target) => target.lineKey === navLineKey,
        )
      : -1;
    const targetIndex =
      currentIndex <= 0 ? sortedCommentTargets.length - 1 : currentIndex - 1;
    const target = sortedCommentTargets[targetIndex];
    setNavLineKey(target.lineKey);
    navigateToComment(target);
  }, [sortedCommentTargets, navLineKey, navigateToComment]);

  const handleNextComment = useCallback(() => {
    if (sortedCommentTargets.length === 0) return;
    const currentIndex = navLineKey
      ? sortedCommentTargets.findIndex(
          (target) => target.lineKey === navLineKey,
        )
      : -1;
    const targetIndex =
      currentIndex === -1 || currentIndex === sortedCommentTargets.length - 1
        ? 0
        : currentIndex + 1;
    const target = sortedCommentTargets[targetIndex];
    setNavLineKey(target.lineKey);
    navigateToComment(target);
  }, [sortedCommentTargets, navLineKey, navigateToComment]);

  useEffect(() => {
    const zones = zonesRef.current;
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      const originalEditor = diffEditorRef.current?.getOriginalEditor();
      const modifiedEditor = diffEditorRef.current?.getModifiedEditor();
      if (originalEditor) {
        originalEditor.changeViewZones((accessor) => {
          for (const [lineKey, entry] of zones.entries()) {
            if (!lineKey.startsWith("LEFT:")) continue;
            accessor.removeZone(entry.zoneId);
          }
        });
      }
      if (modifiedEditor) {
        modifiedEditor.changeViewZones((accessor) => {
          for (const [lineKey, entry] of zones.entries()) {
            if (!lineKey.startsWith("RIGHT:")) continue;
            accessor.removeZone(entry.zoneId);
          }
        });
      }
      zones.clear();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const fileName = fileContent.path;
  const commentCount = comments.length + drafts.length;
  const effectiveFontSize = isMobile ? mobileFontSize : fontSize;

  const portalEntries: React.ReactNode[] = [];
  for (const [lineKey, domNode] of portalTargets) {
    const target = fromLineKey(lineKey);
    if (!target) continue;
    const threadComments = commentsByLine.get(lineKey) ?? [];
    const isNewComment =
      newCommentLine?.line === target.line &&
      newCommentLine.side === target.side &&
      !commentsByLine.has(lineKey);

    if (threadComments.length === 0 && !isNewComment) continue;

    portalEntries.push(
      createPortal(
        <CommentThread
          key={`thread-${lineKey}`}
          comments={threadComments}
          line={target.line}
          isResolved={resolvedLines.has(target.line)}
          isOutdated={outdatedLines.has(target.line)}
          isCollapsed={collapsedLines.has(lineKey)}
          onToggleCollapse={() => {
            setCollapsedLines((prev) => {
              const next = new Set(prev);
              if (next.has(lineKey)) next.delete(lineKey);
              else next.add(lineKey);
              return next;
            });
          }}
          onReply={onReplyToComment}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onDeleteDraft={onDeleteDraft}
          onEditDraft={onEditDraft}
          onResolveThread={onResolveThread}
          currentUserLogin={currentUserLogin}
          onClose={() => {
            if (isNewComment) {
              setNewCommentLine(null);
            } else {
              setCollapsedLines((prev) => new Set(prev).add(lineKey));
            }
          }}
          pendingLine={target.line}
          pendingStartLine={target.line}
          pendingSide={target.side}
          isSubmitting={isSubmittingComment}
        />,
        domNode,
        `portal-${lineKey}`,
      ),
    );
  }

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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
        {portalEntries}
      </div>
    </div>
  );
});
