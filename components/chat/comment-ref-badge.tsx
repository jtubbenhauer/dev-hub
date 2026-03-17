"use client"

import { MessageSquare, Check } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { getAllCachedComments, type CommentRef } from "@/lib/comment-chat-bridge"

interface CommentRefBadgeProps {
  commentRef: CommentRef
  workspaceId: string | null
}

export function CommentRefBadge({ commentRef, workspaceId }: CommentRefBadgeProps) {
  const queryClient = useQueryClient()

  const allComments = workspaceId ? getAllCachedComments(queryClient, workspaceId) : []
  const hasCache = allComments.length > 0
  const liveComment = allComments.find((c) => c.id === commentRef.id)
  const isResolved = liveComment?.resolved === true
  const isDeleted = hasCache && !liveComment

  const fileName = commentRef.filePath.split("/").pop() ?? commentRef.filePath
  const lineRef = commentRef.lineRef.replace(commentRef.filePath, fileName)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight",
        isResolved && "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
        isDeleted && "border-muted bg-muted/50 text-muted-foreground line-through",
        !isResolved && !isDeleted && "border-primary/30 bg-primary/10 text-primary"
      )}
    >
      {isResolved ? (
        <Check className="size-2.5" />
      ) : (
        <MessageSquare className="size-2.5" />
      )}
      {lineRef}
    </span>
  )
}
