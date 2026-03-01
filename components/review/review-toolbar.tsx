"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  ArrowLeft,
  Loader2,
  PanelLeft,
} from "lucide-react"
import type { ReviewWithFiles, ReviewMode } from "@/types"

interface ReviewToolbarProps {
  review: ReviewWithFiles
  isRefreshing: boolean
  onRefresh: () => void
  onBack: () => void
  onOpenFileList?: () => void
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
  onOpenFileList,
}: ReviewToolbarProps) {
  const progress = review.totalFiles > 0
    ? Math.round((review.reviewedFiles / review.totalFiles) * 100)
    : 0

  const isComplete = review.totalFiles > 0 && review.reviewedFiles === review.totalFiles

  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2 md:gap-3 md:px-3">
      <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeft className="h-4 w-4 md:mr-1" />
        <span className="hidden md:inline">Back</span>
      </Button>

      {/* File list toggle - mobile only */}
      {onOpenFileList && (
        <Button variant="ghost" size="sm" onClick={onOpenFileList} className="shrink-0 md:hidden">
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      <div className="hidden h-4 w-px bg-border md:block" />

      <Badge variant="outline" className="hidden shrink-0 text-xs md:inline-flex">
        {modeLabels[review.mode]}
      </Badge>

      {review.targetRef && (
        <span className="hidden truncate font-mono text-xs text-muted-foreground md:inline">
          {review.targetRef}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <div className="flex items-center gap-1.5 md:gap-2">
          <span className="text-xs text-muted-foreground">
            {review.reviewedFiles}/{review.totalFiles}
          </span>
          <div className="h-1.5 w-12 rounded-full bg-muted md:w-20">
            <div
              className={`h-full rounded-full transition-all ${isComplete ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="hidden text-xs text-muted-foreground md:inline">{progress}%</span>
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
