"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
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
  Clock,
  FileDiff,
  RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PrFileList } from "@/components/git/pr-file-list"
import { PrDiffEditor } from "@/components/git/pr-diff-editor"
import type { PrDiffEditorHandle } from "@/components/git/pr-diff-editor"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  useGitHubPrsAwaitingReview,
  useGitHubPrsCreatedByMe,
  useGitHubPrFiles,
  useGitHubPrComments,
  useGitHubPrReviews,
  useGitHubPrChecks,
  useGitHubPrFileContent,
  useGitHubAddComment,
  useGitHubReplyToComment,
  useGitHubSubmitReview,
  useGitHubMergePr,
  useGitHubCurrentUser,
} from "@/hooks/use-github"
import type {
  GitHubPullRequest,
  GitHubReviewEvent,
  GitHubReview,
  GitHubCheckRun,
  GitHubMergeMethod,
  GitHubUser,
} from "@/types"

const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 500
const DEFAULT_PANEL_WIDTH = 280

type PrTab = "for-review" | "my-prs"

interface PrPanelProps {
  onClose: () => void
}

function encodePrParam(pr: GitHubPullRequest): string {
  return `${pr.base.repo.full_name}/${pr.number}`
}

function parsePrParam(param: string): { fullName: string; number: number } | null {
  const match = param.match(/^(.+?)\/(\d+)$/)
  if (!match) return null
  return { fullName: match[1], number: parseInt(match[2], 10) }
}

export function PrPanel({ onClose }: PrPanelProps) {
  const [activeTab, setActiveTab] = useState<PrTab>("for-review")
  const [selectedPr, setSelectedPr] = useState<GitHubPullRequest | null>(null)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [reviewedFilenames, setReviewedFilenames] = useState<Set<string>>(new Set())
  const [isMobileFileListOpen, setIsMobileFileListOpen] = useState(false)
  const [isPrListOpen, setIsPrListOpen] = useState(false)
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false)
  const restoredPrRef = useRef(false)

  const isMobile = useIsMobile()
  const editorHandleRef = useRef<PrDiffEditorHandle>(null)
  const { width: panelWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    defaultWidth: DEFAULT_PANEL_WIDTH,
  })

  const { data: reviewPrs = [], isLoading: isReviewPrsLoading } = useGitHubPrsAwaitingReview()
  const { data: myPrs = [], isLoading: isMyPrsLoading } = useGitHubPrsCreatedByMe()
  const { data: currentUser } = useGitHubCurrentUser()

  useEffect(() => {
    if (restoredPrRef.current || selectedPr) return
    try {
      const stored = localStorage.getItem("dev-hub:git-selected-pr")
      if (!stored) { restoredPrRef.current = true; return }
      const parsed = parsePrParam(stored)
      if (!parsed) { restoredPrRef.current = true; return }
      const allPrs = [...reviewPrs, ...myPrs]
      const match = allPrs.find(
        (pr) => pr.base.repo.full_name === parsed.fullName && pr.number === parsed.number
      )
      if (match) {
        setSelectedPr(match)
        if (reviewPrs.includes(match)) setActiveTab("for-review")
        else setActiveTab("my-prs")
        restoredPrRef.current = true
      }
    } catch { restoredPrRef.current = true }
  }, [reviewPrs, myPrs, selectedPr])

  const owner = selectedPr?.base.repo.owner.login ?? null
  const repo = selectedPr?.base.repo.name ?? null
  const prNumber = selectedPr?.number ?? null
  const baseSha = selectedPr?.base.sha ?? null
  const headSha = selectedPr?.head.sha ?? null

  const { data: prFiles = [], isLoading: isFilesLoading } = useGitHubPrFiles(owner, repo, prNumber)
  const { data: prComments = [] } = useGitHubPrComments(owner, repo, prNumber)
  const { data: prReviews = [] } = useGitHubPrReviews(owner, repo, prNumber)
  const { data: prChecks = [] } = useGitHubPrChecks(owner, repo, headSha)

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
  const mergeMutation = useGitHubMergePr()

  const isMyPr = activeTab === "my-prs"

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
    setIsDescriptionOpen(false)
    try { localStorage.setItem("dev-hub:git-selected-pr", encodePrParam(pr)) } catch {}
  }, [])

  const handleBackToList = useCallback(() => {
    setSelectedPr(null)
    setSelectedFilename(null)
    setReviewedFilenames(new Set())
    setIsDescriptionOpen(false)
    try { localStorage.removeItem("dev-hub:git-selected-pr") } catch {}
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

  const handleMerge = useCallback(
    (mergeMethod: GitHubMergeMethod) => {
      if (!owner || !repo || !prNumber) return
      mergeMutation.mutate({ owner, repo, prNumber, mergeMethod })
    },
    [owner, repo, prNumber, mergeMutation]
  )

  const isPrsLoading = activeTab === "for-review" ? isReviewPrsLoading : isMyPrsLoading
  const activePrs = activeTab === "for-review" ? reviewPrs : myPrs

  if (isPrsLoading && !selectedPr) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
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
    )
  }

  const isSubmittingComment = addCommentMutation.isPending || replyToCommentMutation.isPending

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
        <ChecksStatusBadge checks={prChecks} />
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
<div className="flex h-full min-h-0 flex-1 flex-col">
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

      {/* Bottom bar — review or merge */}
      {selectedPr && !isMyPr && (
        <ReviewSubmitBar
          onSubmit={handleSubmitReview}
          isSubmitting={submitReviewMutation.isPending}
          commentCount={prComments.length}
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
        <SheetContent side="left" className="w-[320px] p-0" showCloseButton={false}>
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
  )
}

// ─── PR list (initial empty state view with tabs) ────────────────────────────

interface PrListViewProps {
  activeTab: PrTab
  onTabChange: (tab: PrTab) => void
  reviewPrs: GitHubPullRequest[]
  myPrs: GitHubPullRequest[]
  isReviewLoading: boolean
  isMyPrsLoading: boolean
  onSelect: (pr: GitHubPullRequest) => void
  onClose: () => void
  currentUser: GitHubUser | null
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
        <TabsList variant="line" className="shrink-0 w-full border-b px-2 pt-1">
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
        <TabsContent value="for-review" className="flex min-h-0 flex-1 flex-col">
          {isReviewLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : reviewPrs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Check className="size-8 text-green-500" />
              <p className="text-sm font-medium">All caught up!</p>
              <p className="text-xs text-muted-foreground">No PRs are waiting for your review.</p>
            </div>
          ) : (
            <PrListItems prs={reviewPrs} selectedPr={null} onSelect={onSelect} currentUser={currentUser} showMyReviewStatus />
          )}
        </TabsContent>
        <TabsContent value="my-prs" className="flex min-h-0 flex-1 flex-col">
          {isMyPrsLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : myPrs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <GitPullRequest className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No open PRs</p>
              <p className="text-xs text-muted-foreground">You don&apos;t have any open pull requests.</p>
            </div>
          ) : (
            <PrListItems prs={myPrs} selectedPr={null} onSelect={onSelect} currentUser={currentUser} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── PR list items ───────────────────────────────────────────────────────────

interface PrListItemsProps {
  prs: GitHubPullRequest[]
  selectedPr: GitHubPullRequest | null
  onSelect: (pr: GitHubPullRequest) => void
  currentUser: GitHubUser | null
  showMyReviewStatus?: boolean
}

function PrListItems({ prs, selectedPr, onSelect, currentUser, showMyReviewStatus }: PrListItemsProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-px p-2">
        {prs.map((pr) => {
          const repoName = pr.base.repo.full_name
          const isSelected = selectedPr?.number === pr.number && selectedPr?.base.repo.full_name === repoName
          const isOwnPr = currentUser?.login === pr.user.login
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
                    {pr.draft && (
                      <span className="rounded bg-muted px-1 py-px text-[10px] font-medium">
                        Draft
                      </span>
                    )}
                    <PrListChecksBadge owner={pr.base.repo.owner.login} repo={pr.base.repo.name} headSha={pr.head.sha} />
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

// ─── My review status for PR list items ──────────────────────────────────────

function MyReviewStatus({ pr, currentUserId }: { pr: GitHubPullRequest; currentUserId: number }) {
  const owner = pr.base.repo.owner.login
  const repo = pr.base.repo.name
  const { data: reviews = [] } = useGitHubPrReviews(owner, repo, pr.number)

  const myState: ReviewDisplayState = useMemo(() => {
    const latestReviews = getLatestReviews(reviews)
    const myReview = latestReviews.find((r) => r.user.id === currentUserId)
    if (!myReview) return "PENDING"
    const isReRequested = pr.requested_reviewers.some((u) => u.id === currentUserId)
    return isReRequested ? "RE_REQUESTED" : myReview.state
  }, [reviews, pr.requested_reviewers, currentUserId])

  const config = getReviewStateConfig(myState)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", config.textColor)}>
          <config.Icon className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.label}</TooltipContent>
    </Tooltip>
  )
}

// ─── CI checks badge for PR list items ───────────────────────────────────────

function PrListChecksBadge({ owner, repo, headSha }: { owner: string; repo: string; headSha: string }) {
  const { data: checks = [] } = useGitHubPrChecks(owner, repo, headSha)
  if (checks.length === 0) return null

  const summary = summarizeChecks(checks)
  return <ChecksIcon status={summary} size="sm" />
}

// ─── PR description + review status (collapsible detail bar) ─────────────────

interface PrDetailBarProps {
  pr: GitHubPullRequest
  reviews: GitHubReview[]
  isOpen: boolean
  onToggle: () => void
}

function PrDetailBar({ pr, reviews, isOpen, onToggle }: PrDetailBarProps) {
  const latestReviews = useMemo(() => getLatestReviews(reviews), [reviews])
  const pendingReviewers = pr.requested_reviewers

  const hasReviewInfo = latestReviews.length > 0 || pendingReviewers.length > 0
  const hasDescription = !!pr.body?.trim()

  if (!hasDescription && !hasReviewInfo) return null

  return (
    <div className="shrink-0 border-b">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/30 transition-colors"
        onClick={onToggle}
      >
        <span className="flex-1 text-[11px] text-muted-foreground">
          {hasReviewInfo && (
            <span className="inline-flex items-center gap-1.5">
              {latestReviews.map((r) => {
                const isReRequested = pendingReviewers.some((u) => u.id === r.user.id)
                const displayState: ReviewDisplayState = isReRequested ? "RE_REQUESTED" : r.state
                return (
                  <ReviewStatusDot key={r.user.id} state={displayState} login={r.user.login} />
                )
              })}
              {pendingReviewers
                .filter((u) => !latestReviews.some((r) => r.user.id === u.id))
                .map((u) => (
                  <ReviewStatusDot key={u.id} state="PENDING" login={u.login} />
                ))}
            </span>
          )}
        </span>
        {isOpen ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
      </button>
      {isOpen && (
        <div className="px-3 pb-2 space-y-2">
          {hasDescription && (
            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {pr.body}
            </div>
          )}
          {hasReviewInfo && (
            <div className="space-y-1">
              {latestReviews.map((r) => {
                const isReRequested = pendingReviewers.some((u) => u.id === r.user.id)
                const displayState: ReviewDisplayState = isReRequested ? "RE_REQUESTED" : r.state
                return (
                  <div key={r.id} className="flex items-center gap-2 text-[11px]">
                    <ReviewStatusBadge state={displayState} />
                    <span className="text-foreground">{r.user.login}</span>
                  </div>
                )
              })}
              {pendingReviewers
                .filter((u) => !latestReviews.some((r) => r.user.id === u.id))
                .map((u) => (
                  <div key={u.id} className="flex items-center gap-2 text-[11px]">
                    <ReviewStatusBadge state="PENDING" />
                    <span className="text-foreground">{u.login}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Review status helpers ───────────────────────────────────────────────────

function ReviewStatusDot({ state, login }: { state: ReviewDisplayState; login: string }) {
  const config = getReviewStateConfig(state)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-0.5", config.textColor)}>
          <config.Icon className="size-2.5" />
          <span className="text-[10px]">{login}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.label} by {login}</TooltipContent>
    </Tooltip>
  )
}

function ReviewStatusBadge({ state }: { state: ReviewDisplayState }) {
  const config = getReviewStateConfig(state)
  return (
    <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", config.textColor)}>
      <config.Icon className="mr-0.5 size-2.5" />
      {config.label}
    </Badge>
  )
}

type ReviewDisplayState = GitHubReview["state"] | "RE_REQUESTED"

function getReviewStateConfig(state: ReviewDisplayState) {
  switch (state) {
    case "APPROVED":
      return { Icon: Check, label: "Approved", textColor: "text-green-500" }
    case "CHANGES_REQUESTED":
      return { Icon: FileDiff, label: "Changes requested", textColor: "text-red-500" }
    case "RE_REQUESTED":
      return { Icon: RotateCcw, label: "Re-requested review", textColor: "text-yellow-500" }
    case "COMMENTED":
      return { Icon: MessageSquare, label: "Commented", textColor: "text-muted-foreground" }
    case "DISMISSED":
      return { Icon: X, label: "Dismissed", textColor: "text-muted-foreground" }
    default:
      return { Icon: Circle, label: "Pending", textColor: "text-yellow-500" }
  }
}

function getLatestReviews(reviews: GitHubReview[]): GitHubReview[] {
  const byUser = new Map<number, GitHubReview>()
  for (const review of reviews) {
    // skip PENDING reviews (draft reviews not yet submitted)
    if (review.state === "PENDING") continue
    const existing = byUser.get(review.user.id)
    if (!existing || (review.submitted_at && existing.submitted_at && review.submitted_at > existing.submitted_at)) {
      byUser.set(review.user.id, review)
    }
  }
  return Array.from(byUser.values())
}

// ─── CI checks status ───────────────────────────────────────────────────────

type ChecksSummary = "success" | "pending" | "failure" | "neutral"

function summarizeChecks(checks: GitHubCheckRun[]): ChecksSummary {
  if (checks.length === 0) return "neutral"
  const hasFailure = checks.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "action_required"
  )
  if (hasFailure) return "failure"
  const hasPending = checks.some((c) => c.status !== "completed")
  if (hasPending) return "pending"
  return "success"
}

function ChecksIcon({ status, size = "md" }: { status: ChecksSummary; size?: "sm" | "md" }) {
  const iconSize = size === "sm" ? "size-3" : "size-3.5"
  switch (status) {
    case "success":
      return <Check className={cn(iconSize, "text-green-500")} />
    case "pending":
      return <CircleDot className={cn(iconSize, "text-yellow-500 animate-pulse")} />
    case "failure":
      return <AlertCircle className={cn(iconSize, "text-red-500")} />
    default:
      return null
  }
}

function ChecksStatusBadge({ checks }: { checks: GitHubCheckRun[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  if (checks.length === 0) return null

  const summary = summarizeChecks(checks)

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded((prev) => !prev)
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
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-2 shadow-md">
          <div className="space-y-1">
            {checks.map((check) => (
              <a
                key={check.id}
                href={check.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-sm px-2 py-1 text-[11px] hover:bg-accent/50 transition-colors"
              >
                <CheckRunIcon check={check} />
                <span className="truncate flex-1">{check.name}</span>
                <ExternalLink className="size-2.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CheckRunIcon({ check }: { check: GitHubCheckRun }) {
  if (check.status !== "completed") {
    return <CircleDot className="size-3 shrink-0 text-yellow-500 animate-pulse" />
  }
  switch (check.conclusion) {
    case "success":
      return <Check className="size-3 shrink-0 text-green-500" />
    case "failure":
    case "timed_out":
    case "action_required":
      return <X className="size-3 shrink-0 text-red-500" />
    case "skipped":
    case "neutral":
      return <Circle className="size-3 shrink-0 text-muted-foreground" />
    default:
      return <Circle className="size-3 shrink-0 text-muted-foreground" />
  }
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
              className="h-7 text-xs text-red-500 border-red-500/30 hover:bg-red-500/10"
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

// ─── Merge action bar ─────────────────────────────────────────────────────────

interface MergeActionBarProps {
  pr: GitHubPullRequest
  checks: GitHubCheckRun[]
  reviews: GitHubReview[]
  onMerge: (method: GitHubMergeMethod) => void
  isMerging: boolean
}

function MergeActionBar({ pr, checks, reviews, onMerge, isMerging }: MergeActionBarProps) {
  const [mergeMethod, setMergeMethod] = useState<GitHubMergeMethod>("squash")

  const checksSummary = summarizeChecks(checks)
  const latestReviews = useMemo(() => getLatestReviews(reviews), [reviews])
  const hasChangesRequested = latestReviews.some((r) => r.state === "CHANGES_REQUESTED")
  const hasConflicts = pr.mergeable === false || pr.mergeable_state === "dirty"
  const isChecksFailing = checksSummary === "failure"
  const isBlocked = pr.mergeable_state === "blocked"
  const isBehind = pr.mergeable_state === "behind"
  const isUnstable = pr.mergeable_state === "unstable"
  const isClean = pr.mergeable_state === "clean"

  // "blocked" means branch protection rules aren't satisfied (e.g. required reviews missing)
  const isMergeDisabled = isMerging || hasConflicts || pr.draft || isBlocked

  return (
    <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex items-center gap-2">
        {/* Status warnings */}
        <div className="flex flex-1 items-center gap-2 text-[11px] flex-wrap">
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
        <Select value={mergeMethod} onValueChange={(v) => setMergeMethod(v as GitHubMergeMethod)}>
          <SelectTrigger className="h-7 w-auto gap-1 text-xs border-r-0 rounded-r-none">
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
          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white rounded-l-none -ml-px"
          onClick={() => onMerge(mergeMethod)}
          disabled={isMergeDisabled}
        >
          {isMerging ? (
            <Loader2 className="size-3 mr-1 animate-spin" />
          ) : (
            <GitMerge className="size-3 mr-1" />
          )}
          Merge
        </Button>
      </div>
    </div>
  )
}
