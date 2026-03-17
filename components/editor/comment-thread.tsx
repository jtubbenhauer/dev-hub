"use client"

import { useState } from "react"
import { Check, MessageCircle, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FileComment } from "@/types"

interface CommentThreadProps {
  comments: FileComment[]
  onResolve: (id: number) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, body: string) => void
  onAttachToChat: (comment: FileComment) => void
  showResolved?: boolean
}

interface CommentItemProps {
  comment: FileComment
  onResolve: (id: number) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, body: string) => void
  onAttachToChat: (comment: FileComment) => void
}

function formatLineRange(startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `L${startLine}`
  }
  return `L${startLine}-L${endLine}`
}

function CommentItem({ comment, onResolve, onDelete, onUpdate, onAttachToChat }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)

  function handleSave() {
    onUpdate(comment.id, editBody)
    setIsEditing(false)
  }

  function handleCancel() {
    setEditBody(comment.body)
    setIsEditing(false)
  }

  function handleEditClick() {
    setEditBody(comment.body)
    setIsEditing(true)
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm",
        comment.resolved && "opacity-50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {formatLineRange(comment.startLine, comment.endLine)}
        </span>
        {comment.createdAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} aria-label="Save">
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} aria-label="Cancel">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-foreground">{comment.body}</p>
      )}

      {!isEditing && (
        <div className="flex gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onResolve(comment.id)}
            aria-label="Resolve"
            title="Resolve"
          >
            <Check />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={handleEditClick}
            aria-label="Edit"
            title="Edit"
          >
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onAttachToChat(comment)}
            aria-label="Attach to chat"
            title="Attach to chat"
          >
            <MessageCircle />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onDelete(comment.id)}
            aria-label="Delete"
            title="Delete"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  )
}

export function CommentThread({
  comments,
  onResolve,
  onDelete,
  onUpdate,
  onAttachToChat,
  showResolved = false,
}: CommentThreadProps) {
  const visible = comments.filter((c) => !c.resolved || showResolved)

  return (
    <div className="flex flex-col gap-2">
      {visible.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          onResolve={onResolve}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onAttachToChat={onAttachToChat}
        />
      ))}
    </div>
  )
}
