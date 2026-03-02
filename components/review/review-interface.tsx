"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReview, useReviewDiff, useToggleReviewFile, useRefreshReview } from "@/hooks/use-review"
import { useGitStage } from "@/hooks/use-git"
import { useReviewStore } from "@/stores/review-store"
import { ReviewToolbar } from "@/components/review/review-toolbar"
import { ReviewFileList } from "@/components/review/review-file-list"
import { ReviewEditor } from "@/components/review/review-editor"
import { ReviewCommitPanel } from "@/components/review/review-commit-panel"
import { useCommand } from "@/hooks/use-command"
import { useIsMobile } from "@/hooks/use-mobile"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ReviewFile } from "@/types"

export function ReviewInterface() {
  const { activeReviewId, selectedFileId, selectFile, clearReview } = useReviewStore()
  const { data: review, isLoading: reviewLoading, error: reviewError } = useReview(activeReviewId)
  const { data: fileContent, isLoading: diffLoading } = useReviewDiff(activeReviewId, selectedFileId)
  const toggleFile = useToggleReviewFile(activeReviewId)
  const refreshReview = useRefreshReview(activeReviewId)
  const stageFile = useGitStage(review?.workspaceId ?? null)
  const isMobile = useIsMobile()
  const [fileListOpen, setFileListOpen] = useState(false)

  const selectedFile = review?.files.find((f) => f.id === selectedFileId) ?? null

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
      if (isMobile) setFileListOpen(false)
    },
    [selectFile, isMobile]
  )

  const handleToggleReviewed = useCallback(
    (file: ReviewFile) => {
      const willBeReviewed = !file.reviewed
      toggleFile.mutate({ fileId: file.id, reviewed: willBeReviewed })

      // Auto-advance when marking as reviewed (not when un-marking)
      if (willBeReviewed && review) {
        const sorted = [...review.files].sort((a, b) => {
          if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1
          return a.path.localeCompare(b.path)
        })
        const currentIdx = sorted.findIndex((f) => f.id === file.id)
        const nextUnreviewed = sorted.find(
          (f, i) => !f.reviewed && i > currentIdx && f.id !== file.id
        )
        if (nextUnreviewed) {
          selectFile(nextUnreviewed.id, nextUnreviewed.path)
        }

        // Auto-stage the file
        stageFile.mutate({ action: "stage", files: [file.path] })
      }
    },
    [toggleFile, review, selectFile, stageFile]
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
        // Auto-stage the file
        stageFile.mutate({ action: "stage", files: [file.path] })
      }

      if (nextUnreviewed) {
        selectFile(nextUnreviewed.id, nextUnreviewed.path)
      }
    },
    [review, toggleFile, selectFile, stageFile]
  )

  // Keep a ref so the command closure stays stable but always calls the latest mutate
  const refreshReviewRef = useRef(refreshReview)
  refreshReviewRef.current = refreshReview

  const reviewCommands = useMemo(
    () => [
      {
        id: "review:refresh",
        label: "Refresh Review",
        group: "Review",
        icon: RefreshCw,
        shortcut: "⇧R",
        onSelect: () => refreshReviewRef.current.mutate(),
      },
    ],
    []
  )

  useCommand(reviewCommands)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.closest(".cm-editor"))
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

  if (reviewLoading && !review) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (reviewError || !review) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="text-lg font-medium">Review not found</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          This review may have been deleted or is no longer available.
        </p>
        <Button variant="outline" onClick={clearReview}>
          Back to review setup
        </Button>
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
        onOpenFileList={isMobile ? () => setFileListOpen(true) : undefined}
      />

      <div className="flex min-h-0 flex-1">
        {/* File list sidebar - desktop */}
        {!isMobile && (
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
            <ReviewCommitPanel workspaceId={review.workspaceId} />
          </div>
        )}

        {/* File list sidebar - mobile sheet */}
        {isMobile && (
          <Sheet open={fileListOpen} onOpenChange={setFileListOpen}>
            <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
              <SheetHeader className="border-b px-3 py-2">
                <SheetTitle className="text-xs font-medium text-muted-foreground">
                  {review.files.filter((f) => !f.reviewed).length} unreviewed
                </SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ReviewFileList
                  files={review.files}
                  selectedFileId={selectedFileId}
                  onSelectFile={handleSelectFile}
                  onToggleReviewed={handleToggleReviewed}
                  onMarkAndNext={handleMarkAndNext}
                />
                <ReviewCommitPanel workspaceId={review.workspaceId} />
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Editor with unified diff view */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedFile && fileContent ? (
            <ReviewEditor
              fileContent={fileContent}
              file={selectedFile}
              workspaceId={review.workspaceId}
              isLoading={diffLoading}
              onToggleReviewed={handleToggleReviewed}
              onMarkAndNext={handleMarkAndNext}
              onOpenFileList={isMobile ? () => setFileListOpen(true) : undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {diffLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-sm text-muted-foreground">Select a file to review</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
