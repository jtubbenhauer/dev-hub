"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ExternalLink,
  GitPullRequest,
  GitMerge,
  Loader2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  MessageSquare,
  PanelLeft,
  Circle,
  CircleDot,
  AlertCircle,
  FileDiff,
  RotateCcw,
  List,
  FolderTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PrFileList } from "@/components/git/pr-file-list";
import { PrDiffEditor } from "@/components/git/pr-diff-editor";
import type { PrDiffEditorHandle } from "@/components/git/pr-diff-editor";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  useGitHubPrsAwaitingReview,
  useGitHubPrsCreatedByMe,
  useGitHubPr,
  useGitHubPrFiles,
  useGitHubPrComments,
  useGitHubPrReviewThreads,
  useGitHubPrReviews,
  useGitHubPrChecks,
  useGitHubPrFileContent,
  useGitHubAddComment,
  useGitHubReplyToComment,
  useGitHubDeleteComment,
  useGitHubSubmitReview,
  useGitHubToggleThreadResolved,
  useGitHubMergePr,
  useGitHubCurrentUser,
  useGitHubPrViewedFiles,
  useGitHubToggleFileViewed,
} from "@/hooks/use-github";
import { useReviewDraftStore } from "@/stores/review-draft-store";
import { GitHubMarkdown } from "@/components/git/github-markdown";
import type {
  GitHubPullRequest,
  GitHubReviewEvent,
  GitHubReview,
  GitHubCheckRun,
  GitHubMergeMethod,
  GitHubUser,
} from "@/types";

const EMPTY_DRAFTS: import("@/stores/review-draft-store").ReviewDraft[] = [];
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 280;

type PrTab = "for-review" | "my-prs";

interface PrPanelProps {
  onClose: () => void;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function encodePrParam(pr: GitHubPullRequest): string {
  return `${pr.base.repo.full_name}/${pr.number}`;
}

function parsePrParam(
  param: string,
): { fullName: string; number: number } | null {
  const match = param.match(/^(.+?)\/(\d+)$/);
  if (!match) return null;
  return { fullName: match[1], number: parseInt(match[2], 10) };
}

export function PrPanel({ onClose }: PrPanelProps) {
  const [activeTab, setActiveTab] = useState<PrTab>("for-review");
  const [selectedPr, setSelectedPr] = useState<GitHubPullRequest | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem("dev-hub:pr-selected-file");
      } catch {
        return null;
      }
    },
  );
  const [isMobileFileListOpen, setIsMobileFileListOpen] = useState(false);
  const [isPrListOpen, setIsPrListOpen] = useState(false);
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
  const [groupByFolder, setGroupByFolder] = useState(false);
  const isMobile = useIsMobile();
  const editorHandleRef = useRef<PrDiffEditorHandle>(null);
  const { width: panelWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    defaultWidth: DEFAULT_PANEL_WIDTH,
    storageKey: "dev-hub:pr-file-panel-width",
  });

  const [storedPrParam, setStoredPrParam] = useState(() => {
    try {
      const stored = localStorage.getItem("dev-hub:git-selected-pr");
      return stored ? parsePrParam(stored) : null;
    } catch {
      return null;
    }
  });

  const storedOwner = storedPrParam?.fullName.split("/")[0] ?? null;
  const storedRepo = storedPrParam?.fullName.split("/")[1] ?? null;
  const storedNumber = storedPrParam?.number ?? null;

  const { data: directPr, isLoading: isDirectPrLoading } = useGitHubPr(
    !selectedPr ? storedOwner : null,
    !selectedPr ? storedRepo : null,
    !selectedPr ? storedNumber : null,
  );

  if (!selectedPr && directPr && !isDirectPrLoading) {
    setSelectedPr(directPr);
  }

  const shouldDeferLists = !!storedPrParam && !selectedPr;

  const { data: reviewPrs = [], isLoading: isReviewPrsLoading } =
    useGitHubPrsAwaitingReview({ enabled: !shouldDeferLists });
  const { data: myPrs = [], isLoading: isMyPrsLoading } =
    useGitHubPrsCreatedByMe({ enabled: !shouldDeferLists });
  const { data: currentUser } = useGitHubCurrentUser();

  const owner = selectedPr?.base.repo.owner.login ?? null;
  const repo = selectedPr?.base.repo.name ?? null;
  const prNumber = selectedPr?.number ?? null;
  const baseSha = selectedPr?.base.sha ?? null;
  const headSha = selectedPr?.head.sha ?? null;

  const { data: prFiles = [], isLoading: isFilesLoading } = useGitHubPrFiles(
    owner,
    repo,
    prNumber,
  );
  const { data: prComments = [] } = useGitHubPrComments(owner, repo, prNumber);
  const { data: prThreads = [] } = useGitHubPrReviewThreads(
    owner,
    repo,
    prNumber,
  );
  const { data: prReviews = [] } = useGitHubPrReviews(owner, repo, prNumber);
  const { data: prChecks = [] } = useGitHubPrChecks(owner, repo, headSha);
  const { data: viewedFilePaths = [] } = useGitHubPrViewedFiles(
    owner,
    repo,
    prNumber,
  );
  const toggleFileViewedMutation = useGitHubToggleFileViewed(
    owner,
    repo,
    prNumber,
  );

  const reviewedFilenames = useMemo(
    () => new Set(viewedFilePaths),
    [viewedFilePaths],
  );

  const resolvedFilename = useMemo(() => {
    if (!selectedFilename) return null;
    if (isFilesLoading || prFiles.length === 0) return selectedFilename;
    const exists = prFiles.some((f) => f.filename === selectedFilename);
    if (!exists) {
      try {
        localStorage.removeItem("dev-hub:pr-selected-file");
      } catch {}
      return null;
    }
    return selectedFilename;
  }, [selectedFilename, prFiles, isFilesLoading]);

  const selectedFile =
    prFiles.find((f) => f.filename === resolvedFilename) ?? null;

  const { data: fileContent, isLoading: isFileContentLoading } =
    useGitHubPrFileContent(owner, repo, selectedFile, baseSha, headSha);

  const addCommentMutation = useGitHubAddComment(owner, repo, prNumber);
  const replyToCommentMutation = useGitHubReplyToComment(owner, repo, prNumber);
  const deleteCommentMutation = useGitHubDeleteComment(owner, repo, prNumber);
  const toggleThreadResolvedMutation = useGitHubToggleThreadResolved(
    owner,
    repo,
    prNumber,
  );
  const submitReviewMutation = useGitHubSubmitReview(owner, repo, prNumber);
  const mergeMutation = useGitHubMergePr();

  const prKey =
    owner && repo && prNumber ? `${owner}/${repo}/${prNumber}` : null;
  const prDrafts = useReviewDraftStore((state) =>
    prKey ? (state.drafts[prKey] ?? EMPTY_DRAFTS) : EMPTY_DRAFTS,
  );
  const addDraft = useReviewDraftStore((state) => state.addDraft);
  const removeDraft = useReviewDraftStore((state) => state.removeDraft);

  const isMyPr = activeTab === "my-prs";

  const commentCountByFilename = useMemo(() => {
    const map = new Map<string, number>();
    for (const comment of prComments) {
      map.set(comment.path, (map.get(comment.path) ?? 0) + 1);
    }
    return map;
  }, [prComments]);

  const fileComments = useMemo(
    () => prComments.filter((c) => c.path === resolvedFilename),
    [prComments, resolvedFilename],
  );

  const fileDrafts = useMemo(
    () => prDrafts.filter((draft) => draft.path === resolvedFilename),
    [prDrafts, resolvedFilename],
  );

  const resolvedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const thread of prThreads) {
      if (!thread.isResolved || thread.path !== resolvedFilename) continue;
      const line = thread.line ?? thread.originalLine;
      if (line) lines.add(line);
    }
    return lines;
  }, [prThreads, resolvedFilename]);

  const outdatedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const thread of prThreads) {
      if (!thread.isOutdated || thread.path !== resolvedFilename) continue;
      const line = thread.line ?? thread.originalLine;
      if (line) lines.add(line);
    }
    return lines;
  }, [prThreads, resolvedFilename]);

  const threadIdByLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const thread of prThreads) {
      if (thread.path !== resolvedFilename) continue;
      const line = thread.line ?? thread.originalLine;
      if (line) map.set(line, thread.id);
    }
    return map;
  }, [prThreads, resolvedFilename]);

  const handleSelectPr = useCallback((pr: GitHubPullRequest) => {
    setSelectedPr(pr);
    setSelectedFilename(null);
    setIsPrListOpen(false);
    setIsDescriptionOpen(false);
    try {
      localStorage.setItem("dev-hub:git-selected-pr", encodePrParam(pr));
      localStorage.removeItem("dev-hub:pr-selected-file");
    } catch {}
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedPr(null);
    setSelectedFilename(null);
    setIsDescriptionOpen(false);
    setStoredPrParam(null);
    try {
      localStorage.removeItem("dev-hub:git-selected-pr");
      localStorage.removeItem("dev-hub:pr-selected-file");
    } catch {}
  }, []);

  const handleSelectFile = useCallback((filename: string) => {
    setSelectedFilename(filename);
    setIsMobileFileListOpen(false);
    try {
      localStorage.setItem("dev-hub:pr-selected-file", filename);
    } catch {}
  }, []);

  const handleToggleReviewed = useCallback(
    (filename: string) => {
      const nodeId = selectedPr?.node_id;
      if (!nodeId) return;
      const isCurrentlyViewed = reviewedFilenames.has(filename);
      toggleFileViewedMutation.mutate({
        pullRequestId: nodeId,
        path: filename,
        viewed: !isCurrentlyViewed,
      });
    },
    [selectedPr?.node_id, reviewedFilenames, toggleFileViewedMutation],
  );

  const handleAddComment = useCallback(
    async (
      body: string,
      line: number,
      startLine: number,
      isInDiffHunk: boolean,
      side: "LEFT" | "RIGHT",
    ) => {
      if (!owner || !repo || !prNumber || !resolvedFilename || !prKey) return;
      if (isMyPr) {
        if (!headSha) return;
        await addCommentMutation.mutateAsync({
          owner,
          repo,
          prNumber,
          body,
          commitId: headSha,
          path: resolvedFilename,
          line,
          startLine: startLine !== line ? startLine : undefined,
          subjectType: isInDiffHunk ? "line" : "file",
        });
        return;
      }
      addDraft(prKey, {
        type: "inline",
        path: resolvedFilename,
        line,
        side,
        body,
        startLine: startLine !== line ? startLine : undefined,
      });
    },
    [
      owner,
      repo,
      prNumber,
      resolvedFilename,
      prKey,
      isMyPr,
      headSha,
      addDraft,
      addCommentMutation,
    ],
  );

  const handleReplyToComment = useCallback(
    async (body: string, inReplyToId: number) => {
      if (!owner || !repo || !prNumber || !prKey) return;
      if (isMyPr) {
        await replyToCommentMutation.mutateAsync({
          owner,
          repo,
          prNumber,
          commentId: inReplyToId,
          body,
        });
        return;
      }
      const originalComment = prComments.find(
        (comment) => comment.id === inReplyToId,
      );
      if (!originalComment) return;
      const line = originalComment.line ?? originalComment.original_line;
      if (line === null || line === undefined) return;
      addDraft(prKey, {
        type: "reply",
        path: originalComment.path,
        line,
        side: "RIGHT",
        body,
        replyToId: inReplyToId,
      });
    },
    [
      owner,
      repo,
      prNumber,
      prKey,
      isMyPr,
      prComments,
      addDraft,
      replyToCommentMutation,
    ],
  );

  const handleDeleteComment = useCallback(
    async (commentId: number) => {
      if (!owner || !repo) return;
      await deleteCommentMutation.mutateAsync({
        owner,
        repo,
        commentId,
      });
    },
    [owner, repo, deleteCommentMutation],
  );

  const handleSubmitReview = useCallback(
    (event: GitHubReviewEvent, body: string) => {
      if (!owner || !repo || !prNumber || !prKey) return;
      submitReviewMutation.mutate({
        owner,
        repo,
        prNumber,
        event,
        body,
        headSha,
        prKey,
      });
    },
    [owner, repo, prNumber, prKey, submitReviewMutation, headSha],
  );

  const handleDeleteDraft = useCallback(
    (draftId: string) => {
      if (!prKey) return;
      removeDraft(prKey, draftId);
    },
    [prKey, removeDraft],
  );

  const handleResolveThread = useCallback(
    (line: number, resolved: boolean) => {
      const threadId = threadIdByLine.get(line);
      if (!threadId) {
        toast.error("Could not find thread for this comment");
        return;
      }
      toggleThreadResolvedMutation.mutate({ threadId, resolved });
    },
    [threadIdByLine, toggleThreadResolvedMutation],
  );

  const handleMerge = useCallback(
    (mergeMethod: GitHubMergeMethod) => {
      if (!owner || !repo || !prNumber) return;
      mergeMutation.mutate({ owner, repo, prNumber, mergeMethod });
    },
    [owner, repo, prNumber, mergeMutation],
  );

  const isPrsLoading =
    activeTab === "for-review" ? isReviewPrsLoading : isMyPrsLoading;
  const activePrs = activeTab === "for-review" ? reviewPrs : myPrs;

  if (!selectedPr && (isDirectPrLoading || (!storedPrParam && isPrsLoading))) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (!selectedPr) {
    return (
      <PrListView
        activeTab={activeTab}
        onTabChange={setActiveTab}
        reviewPrs={reviewPrs}
        myPrs={myPrs}
        isReviewLoading={isReviewPrsLoading}
        isMyPrsLoading={isMyPrsLoading}
        onSelect={handleSelectPr}
        onClose={onClose}
        currentUser={currentUser ?? null}
      />
    );
  }

  const isSubmittingComment =
    addCommentMutation.isPending || replyToCommentMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* PR header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={handleBackToList}>
              <ArrowLeft className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to PR list</TooltipContent>
        </Tooltip>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left transition-opacity hover:opacity-80"
          onClick={() => setIsPrListOpen(true)}
        >
          <GitPullRequest className="text-muted-foreground mt-px size-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-medium">
              {selectedPr.title}
            </p>
            <p className="text-muted-foreground text-[11px]">
              {selectedPr.base.repo.full_name} #{selectedPr.number} · by{" "}
              {selectedPr.user.login}
            </p>
          </div>
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0 p-0.5 transition-colors"
          onClick={() => setIsDescriptionOpen((prev) => !prev)}
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${isDescriptionOpen ? "rotate-180" : ""}`}
          />
        </button>
        <ChecksStatusBadge checks={prChecks} />
        <a
          href={selectedPr.html_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <ExternalLink className="size-3.5" />
        </a>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* PR description + review status collapsible */}
      <PrDetailBar
        pr={selectedPr}
        reviews={prReviews}
        isOpen={isDescriptionOpen}
        onToggle={() => setIsDescriptionOpen((prev) => !prev)}
      />

      {/* Main area */}
      <div className="flex min-h-0 flex-1">
        {/* Mobile file list sheet */}
        {isMobile && (
          <Sheet
            open={isMobileFileListOpen}
            onOpenChange={setIsMobileFileListOpen}
          >
            <SheetContent
              side="left"
              className="w-[280px] p-0"
              showCloseButton={false}
            >
              <SheetHeader className="border-b px-3 py-2">
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-sm">Changed files</SheetTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        onClick={() => setGroupByFolder((prev) => !prev)}
                      >
                        {groupByFolder ? (
                          <List className="size-3.5" />
                        ) : (
                          <FolderTree className="size-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {groupByFolder ? "Flat list" : "Group by folder"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PrFileList
                  files={prFiles}
                  selectedFilename={resolvedFilename}
                  isLoading={isFilesLoading}
                  reviewedFilenames={reviewedFilenames}
                  commentCountByFilename={commentCountByFilename}
                  groupByFolder={groupByFolder}
                  onSelectFile={handleSelectFile}
                  onToggleReviewed={handleToggleReviewed}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Desktop file list */}
        {!isMobile && (
          <div
            className="flex min-h-0 shrink-0 flex-col border-r"
            style={{ width: panelWidth }}
          >
            <div className="flex shrink-0 items-center border-b px-3 py-1.5">
              <span className="text-muted-foreground text-[11px]">
                {prFiles.length} file{prFiles.length !== 1 ? "s" : ""}
              </span>
              {reviewedFilenames.size > 0 && (
                <span className="ml-1.5 text-[11px] text-green-500">
                  · {reviewedFilenames.size} reviewed
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground ml-auto"
                    onClick={() => setGroupByFolder((prev) => !prev)}
                  >
                    {groupByFolder ? (
                      <List className="size-3.5" />
                    ) : (
                      <FolderTree className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {groupByFolder ? "Flat list" : "Group by folder"}
                </TooltipContent>
              </Tooltip>
            </div>
            <PrFileList
              files={prFiles}
              selectedFilename={resolvedFilename}
              isLoading={isFilesLoading}
              reviewedFilenames={reviewedFilenames}
              commentCountByFilename={commentCountByFilename}
              groupByFolder={groupByFolder}
              onSelectFile={handleSelectFile}
              onToggleReviewed={handleToggleReviewed}
            />
          </div>
        )}

        {/* Drag handle — desktop only */}
        {!isMobile && (
          <button
            type="button"
            className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
            onMouseDown={handleDragStart}
            aria-label="Resize file list"
          >
            <GripVertical className="text-muted-foreground/30 size-3.5" />
          </button>
        )}

        {/* Diff editor */}
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {fileContent ? (
            <PrDiffEditor
              ref={editorHandleRef}
              fileContent={fileContent}
              comments={fileComments}
              drafts={fileDrafts}
              resolvedLines={resolvedLines}
              outdatedLines={outdatedLines}
              isLoading={isFileContentLoading}
              isSubmittingComment={isSubmittingComment}
              onAddComment={handleAddComment}
              onReplyToComment={handleReplyToComment}
              onDeleteComment={handleDeleteComment}
              onDeleteDraft={handleDeleteDraft}
              onResolveThread={handleResolveThread}
              currentUserLogin={currentUser?.login ?? null}
              onOpenFileList={
                isMobile ? () => setIsMobileFileListOpen(true) : undefined
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              {resolvedFilename ? (
                isFileContentLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Failed to load file"
                )
              ) : (
                <div className="flex flex-col items-center gap-2 p-6 text-center">
                  {isMobile && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mb-2"
                      onClick={() => setIsMobileFileListOpen(true)}
                    >
                      <PanelLeft className="mr-1.5 size-3.5" />
                      View files
                    </Button>
                  )}
                  <span>Select a file to view diff</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar — review or merge */}
      {selectedPr && !isMyPr && (
        <ReviewSubmitBar
          onSubmit={handleSubmitReview}
          isSubmitting={submitReviewMutation.isPending}
          draftCount={prDrafts.length}
        />
      )}
      {selectedPr && isMyPr && (
        <MergeActionBar
          pr={selectedPr}
          checks={prChecks}
          reviews={prReviews}
          onMerge={handleMerge}
          isMerging={mergeMutation.isPending}
        />
      )}

      {/* PR switcher sheet */}
      <Sheet open={isPrListOpen} onOpenChange={setIsPrListOpen}>
        <SheetContent
          side="left"
          className="w-[320px] p-0"
          showCloseButton={false}
        >
          <SheetHeader className="border-b px-3 py-2">
            <SheetTitle className="text-sm">
              {activeTab === "for-review" ? "PRs awaiting review" : "My PRs"}
            </SheetTitle>
          </SheetHeader>
          <PrListItems
            prs={activePrs}
            selectedPr={selectedPr}
            onSelect={handleSelectPr}
            currentUser={currentUser ?? null}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── PR list (initial empty state view with tabs) ────────────────────────────

interface PrListViewProps {
  activeTab: PrTab;
  onTabChange: (tab: PrTab) => void;
  reviewPrs: GitHubPullRequest[];
  myPrs: GitHubPullRequest[];
  isReviewLoading: boolean;
  isMyPrsLoading: boolean;
  onSelect: (pr: GitHubPullRequest) => void;
  onClose: () => void;
  currentUser: GitHubUser | null;
}

function PrListView({
  activeTab,
  onTabChange,
  reviewPrs,
  myPrs,
  isReviewLoading,
  isMyPrsLoading,
  onSelect,
  onClose,
  currentUser,
}: PrListViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitPullRequest className="size-4" />
          Pull Requests
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as PrTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList variant="line" className="w-full shrink-0 border-b px-2 pt-1">
          <TabsTrigger value="for-review" className="text-xs">
            For Review
            {reviewPrs.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {reviewPrs.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-prs" className="text-xs">
            My PRs
            {myPrs.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {myPrs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="for-review"
          className="flex min-h-0 flex-1 flex-col"
        >
          {isReviewLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : reviewPrs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Check className="size-8 text-green-500" />
              <p className="text-sm font-medium">All caught up!</p>
              <p className="text-muted-foreground text-xs">
                No PRs are waiting for your review.
              </p>
            </div>
          ) : (
            <PrListItems
              prs={reviewPrs}
              selectedPr={null}
              onSelect={onSelect}
              currentUser={currentUser}
              showMyReviewStatus
            />
          )}
        </TabsContent>
        <TabsContent value="my-prs" className="flex min-h-0 flex-1 flex-col">
          {isMyPrsLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : myPrs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <GitPullRequest className="text-muted-foreground size-8" />
              <p className="text-sm font-medium">No open PRs</p>
              <p className="text-muted-foreground text-xs">
                You don&apos;t have any open pull requests.
              </p>
            </div>
          ) : (
            <PrListItems
              prs={myPrs}
              selectedPr={null}
              onSelect={onSelect}
              currentUser={currentUser}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── PR list items ───────────────────────────────────────────────────────────

interface PrListItemsProps {
  prs: GitHubPullRequest[];
  selectedPr: GitHubPullRequest | null;
  onSelect: (pr: GitHubPullRequest) => void;
  currentUser: GitHubUser | null;
  showMyReviewStatus?: boolean;
}

function PrListItems({
  prs,
  selectedPr,
  onSelect,
  currentUser,
  showMyReviewStatus,
}: PrListItemsProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-px p-2">
        {prs.map((pr) => {
          const repoName = pr.base.repo.full_name;
          const isSelected =
            selectedPr?.number === pr.number &&
            selectedPr?.base.repo.full_name === repoName;
          const isOwnPr = currentUser?.login === pr.user.login;
          return (
            <button
              type="button"
              key={`${repoName}/${pr.number}`}
              className={cn(
                "hover:bg-accent/50 w-full rounded-sm px-3 py-2 text-left text-xs transition-colors",
                isSelected && "bg-accent",
              )}
              onClick={() => onSelect(pr)}
            >
              <div className="flex items-start gap-2">
                <GitPullRequest
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    pr.draft ? "text-muted-foreground" : "text-green-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate leading-tight font-medium">
                    {pr.title}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {repoName} #{pr.number} ·{" "}
                    {formatRelativeDate(pr.created_at)}
                  </p>
                  <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[11px]">
                    {!isOwnPr && <span>{pr.user.login}</span>}
                    {showMyReviewStatus && currentUser && (
                      <MyReviewStatus pr={pr} currentUserId={currentUser.id} />
                    )}
                    {pr.review_comments > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="size-3" />
                        {pr.review_comments}
                      </span>
                    )}

                    <PrListChecksBadge
                      owner={pr.base.repo.owner.login}
                      repo={pr.base.repo.name}
                      headSha={pr.head.sha}
                    />
                    <span className="ml-auto">
                      +{pr.additions} -{pr.deletions}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ─── My review status for PR list items ──────────────────────────────────────

function MyReviewStatus({
  pr,
  currentUserId,
}: {
  pr: GitHubPullRequest;
  currentUserId: number;
}) {
  const owner = pr.base.repo.owner.login;
  const repo = pr.base.repo.name;
  const { data: reviews = [] } = useGitHubPrReviews(owner, repo, pr.number);

  const myState: ReviewDisplayState = useMemo(() => {
    const latestReviews = getLatestReviews(reviews);
    const myReview = latestReviews.find((r) => r.user.id === currentUserId);
    if (!myReview) return "PENDING";
    const isReRequested = pr.requested_reviewers.some(
      (u) => u.id === currentUserId,
    );
    return isReRequested ? "RE_REQUESTED" : myReview.state;
  }, [reviews, pr.requested_reviewers, currentUserId]);

  const config = getReviewStateConfig(myState);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", config.textColor)}>
          <config.Icon className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.label}</TooltipContent>
    </Tooltip>
  );
}

// ─── CI checks badge for PR list items ───────────────────────────────────────

function PrListChecksBadge({
  owner,
  repo,
  headSha,
}: {
  owner: string;
  repo: string;
  headSha: string;
}) {
  const { data: checks = [] } = useGitHubPrChecks(owner, repo, headSha);
  if (checks.length === 0) return null;

  const summary = summarizeChecks(checks);
  return <ChecksIcon status={summary} size="sm" />;
}

// ─── PR description + review status (collapsible detail bar) ─────────────────

interface PrDetailBarProps {
  pr: GitHubPullRequest;
  reviews: GitHubReview[];
  isOpen: boolean;
  onToggle: () => void;
}

function PrDetailBar({ pr, reviews, isOpen, onToggle }: PrDetailBarProps) {
  const latestReviews = useMemo(() => getLatestReviews(reviews), [reviews]);
  const pendingReviewers = pr.requested_reviewers;

  const hasReviewInfo = latestReviews.length > 0 || pendingReviewers.length > 0;
  const hasDescription = !!pr.body?.trim();

  if (!hasDescription && !hasReviewInfo) return null;

  return (
    <div className="shrink-0 border-b">
      <button
        type="button"
        className="hover:bg-accent/30 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
        onClick={onToggle}
      >
        <span className="text-muted-foreground flex-1 text-[11px]">
          {hasReviewInfo && (
            <span className="inline-flex items-center gap-1.5">
              {latestReviews.map((r) => {
                const isReRequested = pendingReviewers.some(
                  (u) => u.id === r.user.id,
                );
                const displayState: ReviewDisplayState = isReRequested
                  ? "RE_REQUESTED"
                  : r.state;
                return (
                  <ReviewStatusDot
                    key={r.user.id}
                    state={displayState}
                    login={r.user.login}
                  />
                );
              })}
              {pendingReviewers
                .filter((u) => !latestReviews.some((r) => r.user.id === u.id))
                .map((u) => (
                  <ReviewStatusDot key={u.id} state="PENDING" login={u.login} />
                ))}
            </span>
          )}
        </span>
        {isOpen ? (
          <ChevronUp className="text-muted-foreground size-3" />
        ) : (
          <ChevronDown className="text-muted-foreground size-3" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-2 px-3 pb-2">
          {hasDescription && (
            <div className="bg-muted/30 max-h-48 overflow-y-auto rounded-md px-3 py-2">
              <GitHubMarkdown content={pr.body ?? ""} className="text-xs" />
            </div>
          )}
          {hasReviewInfo && (
            <div className="space-y-1">
              {latestReviews.map((r) => {
                const isReRequested = pendingReviewers.some(
                  (u) => u.id === r.user.id,
                );
                const displayState: ReviewDisplayState = isReRequested
                  ? "RE_REQUESTED"
                  : r.state;
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <ReviewStatusBadge state={displayState} />
                    <span className="text-foreground">{r.user.login}</span>
                  </div>
                );
              })}
              {pendingReviewers
                .filter((u) => !latestReviews.some((r) => r.user.id === u.id))
                .map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <ReviewStatusBadge state="PENDING" />
                    <span className="text-foreground">{u.login}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Review status helpers ───────────────────────────────────────────────────

function ReviewStatusDot({
  state,
  login,
}: {
  state: ReviewDisplayState;
  login: string;
}) {
  const config = getReviewStateConfig(state);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-center gap-0.5", config.textColor)}
        >
          <config.Icon className="size-2.5" />
          <span className="text-[10px]">{login}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {config.label} by {login}
      </TooltipContent>
    </Tooltip>
  );
}

function ReviewStatusBadge({ state }: { state: ReviewDisplayState }) {
  const config = getReviewStateConfig(state);
  return (
    <Badge
      variant="outline"
      className={cn("h-4 px-1 text-[10px]", config.textColor)}
    >
      <config.Icon className="mr-0.5 size-2.5" />
      {config.label}
    </Badge>
  );
}

type ReviewDisplayState = GitHubReview["state"] | "RE_REQUESTED";

function getReviewStateConfig(state: ReviewDisplayState) {
  switch (state) {
    case "APPROVED":
      return { Icon: Check, label: "Approved", textColor: "text-green-500" };
    case "CHANGES_REQUESTED":
      return {
        Icon: FileDiff,
        label: "Changes requested",
        textColor: "text-red-500",
      };
    case "RE_REQUESTED":
      return {
        Icon: RotateCcw,
        label: "Re-requested review",
        textColor: "text-yellow-500",
      };
    case "COMMENTED":
      return {
        Icon: MessageSquare,
        label: "Commented",
        textColor: "text-muted-foreground",
      };
    case "DISMISSED":
      return {
        Icon: X,
        label: "Dismissed",
        textColor: "text-muted-foreground",
      };
    default:
      return { Icon: Circle, label: "Pending", textColor: "text-yellow-500" };
  }
}

function getLatestReviews(reviews: GitHubReview[]): GitHubReview[] {
  const byUser = new Map<number, GitHubReview>();
  for (const review of reviews) {
    // skip PENDING reviews (draft reviews not yet submitted)
    if (review.state === "PENDING") continue;
    const existing = byUser.get(review.user.id);
    if (
      !existing ||
      (review.submitted_at &&
        existing.submitted_at &&
        review.submitted_at > existing.submitted_at)
    ) {
      byUser.set(review.user.id, review);
    }
  }
  return Array.from(byUser.values());
}

// ─── CI checks status ───────────────────────────────────────────────────────

type ChecksSummary = "success" | "pending" | "failure" | "neutral";

function summarizeChecks(checks: GitHubCheckRun[]): ChecksSummary {
  if (checks.length === 0) return "neutral";
  const hasFailure = checks.some(
    (c) =>
      c.conclusion === "failure" ||
      c.conclusion === "timed_out" ||
      c.conclusion === "action_required",
  );
  if (hasFailure) return "failure";
  const hasPending = checks.some((c) => c.status !== "completed");
  if (hasPending) return "pending";
  return "success";
}

function ChecksIcon({
  status,
  size = "md",
}: {
  status: ChecksSummary;
  size?: "sm" | "md";
}) {
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  switch (status) {
    case "success":
      return <Check className={cn(iconSize, "text-green-500")} />;
    case "pending":
      return (
        <CircleDot className={cn(iconSize, "animate-pulse text-yellow-500")} />
      );
    case "failure":
      return <AlertCircle className={cn(iconSize, "text-red-500")} />;
    default:
      return null;
  }
}

function ChecksStatusBadge({ checks }: { checks: GitHubCheckRun[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (checks.length === 0) return null;

  const summary = summarizeChecks(checks);

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-[11px] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
          >
            <ChecksIcon status={summary} />
            <span>{checks.length}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {summary === "success" && "All checks passed"}
          {summary === "pending" && "Checks in progress"}
          {summary === "failure" && "Some checks failed"}
          {summary === "neutral" && "No checks"}
        </TooltipContent>
      </Tooltip>
      {isExpanded && (
        <div className="bg-popover absolute top-full right-0 z-50 mt-1 w-64 rounded-md border p-2 shadow-md">
          <div className="space-y-1">
            {checks.map((check) => (
              <a
                key={check.id}
                href={check.html_url}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-accent/50 flex items-center gap-2 rounded-sm px-2 py-1 text-[11px] transition-colors"
              >
                <CheckRunIcon check={check} />
                <span className="flex-1 truncate">{check.name}</span>
                <ExternalLink className="text-muted-foreground size-2.5 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRunIcon({ check }: { check: GitHubCheckRun }) {
  if (check.status !== "completed") {
    return (
      <CircleDot className="size-3 shrink-0 animate-pulse text-yellow-500" />
    );
  }
  switch (check.conclusion) {
    case "success":
      return <Check className="size-3 shrink-0 text-green-500" />;
    case "failure":
    case "timed_out":
    case "action_required":
      return <X className="size-3 shrink-0 text-red-500" />;
    case "skipped":
    case "neutral":
      return <Circle className="text-muted-foreground size-3 shrink-0" />;
    default:
      return <Circle className="text-muted-foreground size-3 shrink-0" />;
  }
}

// ─── Review submission bar ────────────────────────────────────────────────────

interface ReviewSubmitBarProps {
  onSubmit: (event: GitHubReviewEvent, body: string) => void;
  isSubmitting: boolean;
  draftCount: number;
}

function ReviewSubmitBar({
  onSubmit,
  isSubmitting,
  draftCount,
}: ReviewSubmitBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [reviewBody, setReviewBody] = useState("");

  const handleSubmit = useCallback(
    (event: GitHubReviewEvent) => {
      onSubmit(event, reviewBody);
      setReviewBody("");
      setIsExpanded(false);
    },
    [onSubmit, reviewBody],
  );

  if (!isExpanded) {
    return (
      <div className="bg-muted/10 flex shrink-0 items-center gap-2 border-t px-3 py-2">
        {draftCount > 0 && (
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <MessageSquare className="size-3" />
            {draftCount} draft{draftCount !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setIsExpanded(true)}
        >
          Review changes
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-muted/10 shrink-0 border-t px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Submit review</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setIsExpanded(false)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <textarea
        value={reviewBody}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
          setReviewBody(e.target.value)
        }
        placeholder="Leave a review comment (optional)"
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring mb-2 min-h-[72px] w-full resize-none rounded-md border px-3 py-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
      />
      <div className="flex justify-end gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleSubmit("COMMENT")}
              disabled={isSubmitting}
            >
              <MessageSquare className="mr-1 size-3" />
              Comment
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Submit general feedback without approval
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-red-500/30 text-xs text-red-500 hover:bg-red-500/10"
              onClick={() => handleSubmit("REQUEST_CHANGES")}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <X className="mr-1 size-3" />
              )}
              Request changes
            </Button>
          </TooltipTrigger>
          <TooltipContent>Request changes before merging</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-7 bg-green-600 text-xs text-white hover:bg-green-700"
              onClick={() => handleSubmit("APPROVE")}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Check className="mr-1 size-3" />
              )}
              Approve
            </Button>
          </TooltipTrigger>
          <TooltipContent>Approve this pull request</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// ─── Merge action bar ─────────────────────────────────────────────────────────

interface MergeActionBarProps {
  pr: GitHubPullRequest;
  checks: GitHubCheckRun[];
  reviews: GitHubReview[];
  onMerge: (method: GitHubMergeMethod) => void;
  isMerging: boolean;
}

function MergeActionBar({
  pr,
  checks,
  reviews,
  onMerge,
  isMerging,
}: MergeActionBarProps) {
  const [mergeMethod, setMergeMethod] = useState<GitHubMergeMethod>("squash");

  const checksSummary = summarizeChecks(checks);
  const latestReviews = useMemo(() => getLatestReviews(reviews), [reviews]);
  const hasChangesRequested = latestReviews.some(
    (r) => r.state === "CHANGES_REQUESTED",
  );
  const hasConflicts = pr.mergeable === false || pr.mergeable_state === "dirty";
  const isChecksFailing = checksSummary === "failure";
  const isBlocked = pr.mergeable_state === "blocked";
  const isBehind = pr.mergeable_state === "behind";
  const isUnstable = pr.mergeable_state === "unstable";
  const isClean = pr.mergeable_state === "clean";

  // "blocked" means branch protection rules aren't satisfied (e.g. required reviews missing)
  const isMergeDisabled = isMerging || hasConflicts || pr.draft || isBlocked;

  return (
    <div className="bg-muted/10 shrink-0 border-t px-3 py-2">
      <div className="flex items-center gap-2">
        {/* Status warnings */}
        <div className="flex flex-1 flex-wrap items-center gap-2 text-[11px]">
          {hasConflicts && (
            <span className="flex items-center gap-1 text-red-500">
              <AlertCircle className="size-3" />
              Conflicts
            </span>
          )}
          {isChecksFailing && (
            <span className="flex items-center gap-1 text-red-500">
              <X className="size-3" />
              Checks failing
            </span>
          )}
          {hasChangesRequested && (
            <span className="flex items-center gap-1 text-red-500">
              <FileDiff className="size-3" />
              Changes requested
            </span>
          )}
          {isBlocked && !hasConflicts && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertCircle className="size-3" />
              Required checks not met
            </span>
          )}
          {isBehind && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertCircle className="size-3" />
              Branch behind base
            </span>
          )}
          {isUnstable && !isChecksFailing && (
            <span className="flex items-center gap-1 text-yellow-600">
              <CircleDot className="size-3" />
              Checks pending
            </span>
          )}
          {isClean && !hasChangesRequested && (
            <span className="flex items-center gap-1 text-green-500">
              <Check className="size-3" />
              Ready to merge
            </span>
          )}
        </div>

        {/* Merge method selector + button */}
        <Select
          value={mergeMethod}
          onValueChange={(v) => setMergeMethod(v as GitHubMergeMethod)}
        >
          <SelectTrigger className="h-7 w-auto gap-1 rounded-r-none border-r-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="squash">Squash and merge</SelectItem>
            <SelectItem value="merge">Merge commit</SelectItem>
            <SelectItem value="rebase">Rebase and merge</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="-ml-px h-7 rounded-l-none bg-green-600 text-xs text-white hover:bg-green-700"
          onClick={() => onMerge(mergeMethod)}
          disabled={isMergeDisabled}
        >
          {isMerging ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <GitMerge className="mr-1 size-3" />
          )}
          Merge
        </Button>
      </div>
    </div>
  );
}
