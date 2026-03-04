"use client"

import { useState, useCallback, useMemo, useRef } from "react"
import {
  ExternalLink,
  GitPullRequest,
  Loader2,
  GripVertical,
  ChevronDown,
  Check,
  X,
  MessageSquare,
  PanelLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PrFileList } from "@/components/git/pr-file-list"
import { PrDiffEditor } from "@/components/git/pr-diff-editor"
import type { PrDiffEditorHandle } from "@/components/git/pr-diff-editor"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  useGitHubPrsAwaitingReview,
  useGitHubPrFiles,
  useGitHubPrComments,
  useGitHubPrFileContent,
  useGitHubAddComment,
  useGitHubReplyToComment,
  useGitHubSubmitReview,
} from "@/hooks/use-github"
import type { GitHubPullRequest, GitHubReviewEvent } from "@/types"

const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 500
const DEFAULT_PANEL_WIDTH = 280

interface PrPanelProps {
  onClose: () => void
}

export function PrPanel({ onClose }: PrPanelProps) {
  const [selectedPr, setSelectedPr] = useState<GitHubPullRequest | null>(null)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [reviewedFilenames, setReviewedFilenames] = useState<Set<string>>(new Set())
  const [isMobileFileListOpen, setIsMobileFileListOpen] = useState(false)
  const [isPrListOpen, setIsPrListOpen] = useState(false)

  const isMobile = useIsMobile()
  const editorHandleRef = useRef<PrDiffEditorHandle>(null)
  const { width: panelWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    defaultWidth: DEFAULT_PANEL_WIDTH,
  })

  const { data: prs = [], isLoading: isPrsLoading } = useGitHubPrsAwaitingReview()

  const owner = selectedPr?.base.repo.owner.login ?? null
  const repo = selectedPr?.base.repo.name ?? null
  const prNumber = selectedPr?.number ?? null
  const baseSha = selectedPr?.base.sha ?? null
  const headSha = selectedPr?.head.sha ?? null

  const { data: prFiles = [], isLoading: isFilesLoading } = useGitHubPrFiles(owner, repo, prNumber)
  const { data: prComments = [] } = useGitHubPrComments(owner, repo, prNumber)

  const selectedFile = prFiles.find((f) => f.filename === selectedFilename) ?? null

  const { data: fileContent, isLoading: isFileContentLoading } = useGitHubPrFileContent(
    owner,
    repo,
    selectedFile,
    baseSha,
    headSha
  )

  const addCommentMutation = useGitHubAddComment(owner, repo, prNumber)
  const replyToCommentMutation = useGitHubReplyToComment(owner, repo, prNumber)
  const submitReviewMutation = useGitHubSubmitReview(owner, repo, prNumber)

  const commentCountByFilename = useMemo(() => {
    const map = new Map<string, number>()
    for (const comment of prComments) {
      map.set(comment.path, (map.get(comment.path) ?? 0) + 1)
    }
    return map
  }, [prComments])

  const fileComments = useMemo(
    () => prComments.filter((c) => c.path === selectedFilename),
    [prComments, selectedFilename]
  )

  const handleSelectPr = useCallback((pr: GitHubPullRequest) => {
    setSelectedPr(pr)
    setSelectedFilename(null)
    setReviewedFilenames(new Set())
    setIsPrListOpen(false)
  }, [])

  const handleSelectFile = useCallback((filename: string) => {
    setSelectedFilename(filename)
    setIsMobileFileListOpen(false)
  }, [])

  const handleToggleReviewed = useCallback((filename: string) => {
    setReviewedFilenames((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else {
        next.add(filename)
      }
      return next
    })
  }, [])

  const handleAddComment = useCallback(
    async (body: string, line: number, startLine: number) => {
      if (!owner || !repo || !prNumber || !selectedFilename || !headSha) return
      await addCommentMutation.mutateAsync({
        owner,
        repo,
        prNumber,
        body,
        commitId: headSha,
        path: selectedFilename,
        line,
        startLine: startLine !== line ? startLine : undefined,
      })
    },
    [owner, repo, prNumber, selectedFilename, headSha, addCommentMutation]
  )

  const handleReplyToComment = useCallback(
    async (body: string, inReplyToId: number) => {
      if (!owner || !repo || !prNumber) return
      await replyToCommentMutation.mutateAsync({
        owner,
        repo,
        prNumber,
        commentId: inReplyToId,
        body,
      })
    },
    [owner, repo, prNumber, replyToCommentMutation]
  )

  const handleSubmitReview = useCallback(
    (event: GitHubReviewEvent, body: string) => {
      if (!owner || !repo || !prNumber) return
      submitReviewMutation.mutate({ owner, repo, prNumber, event, body })
    },
    [owner, repo, prNumber, submitReviewMutation]
  )

  if (isPrsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!selectedPr) {
    return <PrListView prs={prs} isLoading={isPrsLoading} onSelect={handleSelectPr} onClose={onClose} />
  }

  const isSubmittingComment = addCommentMutation.isPending || replyToCommentMutation.isPending

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* PR header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <button
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left hover:opacity-80 transition-opacity"
          onClick={() => setIsPrListOpen(true)}
        >
          <GitPullRequest className="mt-px size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{selectedPr.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {selectedPr.base.repo.full_name} #{selectedPr.number} · by {selectedPr.user.login}
            </p>
          </div>
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <a
          href={selectedPr.html_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Main area */}
      <div className="flex min-h-0 flex-1">
        {/* Mobile file list sheet */}
        {isMobile && (
          <Sheet open={isMobileFileListOpen} onOpenChange={setIsMobileFileListOpen}>
            <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
              <SheetHeader className="border-b px-3 py-2">
                <SheetTitle className="text-sm">Changed files</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PrFileList
                  files={prFiles}
                  selectedFilename={selectedFilename}
                  isLoading={isFilesLoading}
                  reviewedFilenames={reviewedFilenames}
                  commentCountByFilename={commentCountByFilename}
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
              <span className="text-[11px] text-muted-foreground">
                {prFiles.length} file{prFiles.length !== 1 ? "s" : ""}
              </span>
              {reviewedFilenames.size > 0 && (
                <span className="ml-1.5 text-[11px] text-green-500">
                  · {reviewedFilenames.size} reviewed
                </span>
              )}
            </div>
            <PrFileList
              files={prFiles}
              selectedFilename={selectedFilename}
              isLoading={isFilesLoading}
              reviewedFilenames={reviewedFilenames}
              commentCountByFilename={commentCountByFilename}
              onSelectFile={handleSelectFile}
              onToggleReviewed={handleToggleReviewed}
            />
          </div>
        )}

        {/* Drag handle — desktop only */}
        {!isMobile && (
          <div
            className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors"
            onMouseDown={handleDragStart}
          >
            <GripVertical className="size-3.5 text-muted-foreground/30" />
          </div>
        )}

        {/* Diff editor */}
        <div className="flex min-h-0 flex-1 flex-col">
          {fileContent ? (
            <PrDiffEditor
              ref={editorHandleRef}
              fileContent={fileContent}
              comments={fileComments}
              isLoading={isFileContentLoading}
              isSubmittingComment={isSubmittingComment}
              onAddComment={handleAddComment}
              onReplyToComment={handleReplyToComment}
              onOpenFileList={isMobile ? () => setIsMobileFileListOpen(true) : undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {selectedFilename ? (
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

      {/* Review submission bar */}
      {selectedPr && (
        <ReviewSubmitBar
          onSubmit={handleSubmitReview}
          isSubmitting={submitReviewMutation.isPending}
          commentCount={prComments.length}
        />
      )}

      {/* PR switcher sheet */}
      <Sheet open={isPrListOpen} onOpenChange={setIsPrListOpen}>
        <SheetContent side="left" className="w-[320px] p-0" showCloseButton={false}>
          <SheetHeader className="border-b px-3 py-2">
            <SheetTitle className="text-sm">PRs awaiting review</SheetTitle>
          </SheetHeader>
          <PrListItems prs={prs} selectedPr={selectedPr} onSelect={handleSelectPr} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── PR list (initial empty state view) ──────────────────────────────────────

interface PrListViewProps {
  prs: GitHubPullRequest[]
  isLoading: boolean
  onSelect: (pr: GitHubPullRequest) => void
  onClose: () => void
}

function PrListView({ prs, isLoading, onSelect, onClose }: PrListViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitPullRequest className="size-4" />
          PRs awaiting your review
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : prs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <Check className="size-8 text-green-500" />
          <p className="text-sm font-medium">All caught up!</p>
          <p className="text-xs text-muted-foreground">No PRs are waiting for your review.</p>
        </div>
      ) : (
        <PrListItems prs={prs} selectedPr={null} onSelect={onSelect} />
      )}
    </div>
  )
}

interface PrListItemsProps {
  prs: GitHubPullRequest[]
  selectedPr: GitHubPullRequest | null
  onSelect: (pr: GitHubPullRequest) => void
}

function PrListItems({ prs, selectedPr, onSelect }: PrListItemsProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-px p-2">
        {prs.map((pr) => {
          const repoName = pr.base.repo.full_name
          const isSelected = selectedPr?.number === pr.number && selectedPr?.base.repo.full_name === repoName
          return (
            <button
              key={`${repoName}/${pr.number}`}
              className={cn(
                "w-full rounded-sm px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50",
                isSelected && "bg-accent"
              )}
              onClick={() => onSelect(pr)}
            >
              <div className="flex items-start gap-2">
                <GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground leading-tight">{pr.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {repoName} #{pr.number}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{pr.user.login}</span>
                    {pr.review_comments > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="size-3" />
                        {pr.review_comments}
                      </span>
                    )}
                    {pr.draft && (
                      <span className="rounded bg-muted px-1 py-px text-[10px] font-medium">
                        Draft
                      </span>
                    )}
                    <span className="ml-auto">
                      +{pr.additions} -{pr.deletions}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}

// ─── Review submission bar ────────────────────────────────────────────────────

interface ReviewSubmitBarProps {
  onSubmit: (event: GitHubReviewEvent, body: string) => void
  isSubmitting: boolean
  commentCount: number
}

function ReviewSubmitBar({ onSubmit, isSubmitting, commentCount }: ReviewSubmitBarProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [reviewBody, setReviewBody] = useState("")

  const handleSubmit = useCallback(
    (event: GitHubReviewEvent) => {
      onSubmit(event, reviewBody)
      setReviewBody("")
      setIsExpanded(false)
    },
    [onSubmit, reviewBody]
  )

  if (!isExpanded) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t bg-muted/10 px-3 py-2">
        {commentCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" />
            {commentCount} comment{commentCount !== 1 ? "s" : ""}
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
    )
  }

  return (
    <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex items-center justify-between mb-2">
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
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReviewBody(e.target.value)}
        placeholder="Leave a review comment (optional)"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[72px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-2"
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
              <MessageSquare className="size-3 mr-1" />
              Comment
            </Button>
          </TooltipTrigger>
          <TooltipContent>Submit general feedback without approval</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-yellow-600 border-yellow-600/30 hover:bg-yellow-500/10"
              onClick={() => handleSubmit("REQUEST_CHANGES")}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <X className="size-3 mr-1" />
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
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={() => handleSubmit("APPROVE")}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Check className="size-3 mr-1" />
              )}
              Approve
            </Button>
          </TooltipTrigger>
          <TooltipContent>Approve this pull request</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
