"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  ArrowLeft,
  Loader2,
} from "lucide-react"
import type { ReviewWithFiles, ReviewMode } from "@/types"

interface ReviewToolbarProps {
  review: ReviewWithFiles
  isRefreshing: boolean
  onRefresh: () => void
  onBack: () => void
}

const modeLabels: Record<ReviewMode, string> = {
  branch: "Branch",
  uncommitted: "Uncommitted",
  "last-commit": "Last Commit",
}

export function ReviewToolbar({
  review,
  isRefreshing,
  onRefresh,
  onBack,
}: ReviewToolbarProps) {
  const progress = review.totalFiles > 0
    ? Math.round((review.reviewedFiles / review.totalFiles) * 100)
    : 0

  const isComplete = review.totalFiles > 0 && review.reviewedFiles === review.totalFiles

  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      <div className="h-4 w-px bg-border" />

      <Badge variant="outline" className="shrink-0 text-xs">
        {modeLabels[review.mode]}
      </Badge>

      {review.targetRef && (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {review.targetRef}
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {review.reviewedFiles}/{review.totalFiles}
          </span>
          <div className="h-1.5 w-20 rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${isComplete ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{progress}%</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
