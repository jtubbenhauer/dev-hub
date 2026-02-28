"use client"

import { useCallback, useEffect } from "react"
import { useReview, useReviewDiff, useToggleReviewFile, useRefreshReview } from "@/hooks/use-review"
import { useReviewStore } from "@/stores/review-store"
import { ReviewToolbar } from "@/components/review/review-toolbar"
import { ReviewFileList } from "@/components/review/review-file-list"
import { DiffViewer } from "@/components/git/diff-viewer"
import { Loader2 } from "lucide-react"
import type { ReviewFile } from "@/types"

export function ReviewInterface() {
  const { activeReviewId, selectedFileId, selectFile, clearReview } = useReviewStore()
  const { data: review, isLoading: reviewLoading } = useReview(activeReviewId)
  const { data: diffData, isLoading: diffLoading } = useReviewDiff(activeReviewId, selectedFileId)
  const toggleFile = useToggleReviewFile(activeReviewId)
  const refreshReview = useRefreshReview(activeReviewId)

  // Auto-select first unreviewed file when review loads or selection is empty
  useEffect(() => {
    if (!review || selectedFileId !== null) return
    const firstUnreviewed = [...review.files]
      .sort((a, b) => {
        if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1
        return a.path.localeCompare(b.path)
      })
      .find((f) => !f.reviewed)

    if (firstUnreviewed) {
      selectFile(firstUnreviewed.id, firstUnreviewed.path)
    } else if (review.files.length > 0) {
      selectFile(review.files[0].id, review.files[0].path)
    }
  }, [review, selectedFileId, selectFile])

  // Auto-refresh on window focus
  useEffect(() => {
    if (!activeReviewId) return

    function handleFocus() {
      refreshReview.mutate()
    }

    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [activeReviewId, refreshReview])

  const handleSelectFile = useCallback(
    (file: ReviewFile) => {
      selectFile(file.id, file.path)
    },
    [selectFile]
  )

  const handleToggleReviewed = useCallback(
    (file: ReviewFile) => {
      toggleFile.mutate({ fileId: file.id, reviewed: !file.reviewed })
    },
    [toggleFile]
  )

  const handleMarkAndNext = useCallback(
    (file: ReviewFile) => {
      if (!review) return

      // Capture next unreviewed BEFORE marking current
      const sorted = [...review.files].sort((a, b) => {
        if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1
        return a.path.localeCompare(b.path)
      })
      const currentIdx = sorted.findIndex((f) => f.id === file.id)
      const nextUnreviewed = sorted.find(
        (f, i) => !f.reviewed && i > currentIdx && f.id !== file.id
      )

      if (!file.reviewed) {
        toggleFile.mutate({ fileId: file.id, reviewed: true })
      }

      if (nextUnreviewed) {
        selectFile(nextUnreviewed.id, nextUnreviewed.path)
      }
    },
    [review, toggleFile, selectFile]
  )

  // Handle Enter key to open selected file diff (already shown, but ensure selection)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (e.key === "R" && e.shiftKey) {
        e.preventDefault()
        refreshReview.mutate()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [refreshReview])

  if (reviewLoading || !review) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewToolbar
        review={review}
        isRefreshing={refreshReview.isPending}
        onRefresh={() => refreshReview.mutate()}
        onBack={clearReview}
      />

      <div className="flex min-h-0 flex-1">
        {/* File list sidebar */}
        <div className="flex w-64 shrink-0 flex-col border-r lg:w-72">
          <div className="shrink-0 border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {review.files.filter((f) => !f.reviewed).length} unreviewed
            </span>
          </div>
          <ReviewFileList
            files={review.files}
            selectedFileId={selectedFileId}
            onSelectFile={handleSelectFile}
            onToggleReviewed={handleToggleReviewed}
            onMarkAndNext={handleMarkAndNext}
          />
        </div>

        {/* Diff viewer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DiffViewer
            diff={diffData?.diff ?? ""}
            fileName={diffData?.path}
            isLoading={diffLoading}
          />
        </div>
      </div>
    </div>
  )
}
