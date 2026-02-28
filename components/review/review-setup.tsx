"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { GitBranch, GitCommitHorizontal, FileText, Loader2 } from "lucide-react"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useReviewBranches, useCreateReview, useReviewList, useDeleteReview } from "@/hooks/use-review"
import { useReviewStore } from "@/stores/review-store"
import type { ReviewMode, Review, AllBranch } from "@/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export function ReviewSetup() {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const { setActiveReviewId } = useReviewStore()

  const [mode, setMode] = useState<ReviewMode>("branch")
  const [targetRef, setTargetRef] = useState("")
  const [branchFilter, setBranchFilter] = useState("")

  const { data: branches = [], isLoading: branchesLoading } = useReviewBranches(activeWorkspaceId)
  const { data: existingReviews = [] } = useReviewList(activeWorkspaceId)
  const createReview = useCreateReview()
  const deleteReview = useDeleteReview(activeWorkspaceId)

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(branchFilter.toLowerCase())
  )

  function handleCreate() {
    if (!activeWorkspaceId) return
    createReview.mutate(
      {
        workspaceId: activeWorkspaceId,
        mode,
        targetRef: mode === "branch" ? targetRef || undefined : undefined,
      },
      {
        onSuccess: (review) => {
          setActiveReviewId(review.id)
        },
      }
    )
  }

  function handleResume(review: Review) {
    setActiveReviewId(review.id)
  }

  function handleDelete(reviewId: string) {
    deleteReview.mutate(reviewId)
  }

  if (!activeWorkspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <GitBranch className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg text-muted-foreground">
            Select a workspace to start a review
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the workspace switcher in the header
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-4 md:p-6">
      <h1 className="mb-6 shrink-0 text-2xl font-bold">Code Review</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* New review */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Start New Review</h2>
            <p className="text-sm text-muted-foreground">
              Review changes in <span className="font-mono">{activeWorkspace.name}</span>
            </p>

            <div className="space-y-2">
              <Label>Review Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as ReviewMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">
                    <span className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      Branch — compare against a branch
                    </span>
                  </SelectItem>
                  <SelectItem value="uncommitted">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Uncommitted — staged + unstaged changes
                    </span>
                  </SelectItem>
                  <SelectItem value="last-commit">
                    <span className="flex items-center gap-2">
                      <GitCommitHorizontal className="h-4 w-4" />
                      Last Commit — review HEAD~1..HEAD
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "branch" && (
              <div className="space-y-2">
                <Label>Target Branch</Label>
                {branchesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading branches...
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Filter branches..."
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      className="text-sm"
                    />
                    <ScrollArea className="h-48 rounded-md border">
                      <div className="p-1">
                        {filteredBranches.map((branch) => (
                          <BranchItem
                            key={branch.name}
                            branch={branch}
                            isSelected={targetRef === branch.name}
                            onSelect={() => setTargetRef(branch.name)}
                          />
                        ))}
                        {filteredBranches.length === 0 && (
                          <p className="p-2 text-center text-sm text-muted-foreground">
                            No branches found
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={createReview.isPending || (mode === "branch" && !targetRef)}
              className="w-full"
            >
              {createReview.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Start Review"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Existing reviews */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Existing Reviews</h2>
            {existingReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active reviews for this workspace
              </p>
            ) : (
              <div className="space-y-2">
                {existingReviews.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    onResume={() => handleResume(review)}
                    onDelete={() => handleDelete(review.id)}
                    isDeleting={deleteReview.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function BranchItem({
  branch,
  isSelected,
  onSelect,
}: {
  branch: AllBranch
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted"
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-mono text-xs">{branch.name}</span>
      {branch.isRemote && (
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
          remote
        </Badge>
      )}
      {branch.current && (
        <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
          current
        </Badge>
      )}
    </button>
  )
}

function ReviewItem({
  review,
  onResume,
  onDelete,
  isDeleting,
}: {
  review: Review
  onResume: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const modeLabels: Record<ReviewMode, string> = {
    branch: "Branch",
    uncommitted: "Uncommitted",
    "last-commit": "Last Commit",
  }

  const progress = review.totalFiles > 0
    ? Math.round((review.reviewedFiles / review.totalFiles) * 100)
    : 0

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {modeLabels[review.mode]}
          </Badge>
          {review.targetRef && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {review.targetRef}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {review.reviewedFiles}/{review.totalFiles} files reviewed ({progress}%)
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="outline" onClick={onResume}>
          Resume
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={isDeleting}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
