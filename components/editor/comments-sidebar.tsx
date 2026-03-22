"use client";

import { useMemo, useState } from "react";
import { Check, MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FileComment } from "@/types";

interface CommentsSidebarProps {
  comments: FileComment[];
  onScrollToLine: (line: number) => void;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, body: string) => void;
  onAttachToChat: (comment: FileComment) => void;
  onClose: () => void;
}

interface CommentCardProps {
  comment: FileComment;
  onScrollToLine: (line: number) => void;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, body: string) => void;
  onAttachToChat: (comment: FileComment) => void;
}

function formatLineRange(startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `L${startLine}`;
  }
  return `L${startLine}-L${endLine}`;
}

function CommentCard({
  comment,
  onScrollToLine,
  onResolve,
  onDelete,
  onUpdate,
  onAttachToChat,
}: CommentCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  function handleSave() {
    onUpdate(comment.id, editBody);
    setIsEditing(false);
  }

  function handleCancel() {
    setEditBody(comment.body);
    setIsEditing(false);
  }

  function handleEditClick() {
    setEditBody(comment.body);
    setIsEditing(true);
  }

  return (
    <div
      className={cn(
        "border-border bg-card flex flex-col gap-2 rounded-md border p-3 text-sm",
        comment.resolved && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onScrollToLine(comment.startLine)}
          className="text-muted-foreground hover:text-foreground rounded-sm font-mono text-xs transition-colors"
          aria-label={`Go to line ${comment.startLine}`}
        >
          {formatLineRange(comment.startLine, comment.endLine)}
        </button>
        {comment.createdAt && (
          <span className="text-muted-foreground text-xs">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="border-input bg-background focus-visible:ring-ring min-h-[80px] w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} aria-label="Save">
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              aria-label="Cancel"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-foreground whitespace-pre-wrap">{comment.body}</p>
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
  );
}

export function CommentsSidebar({
  comments,
  onScrollToLine,
  onResolve,
  onDelete,
  onUpdate,
  onAttachToChat,
  onClose,
}: CommentsSidebarProps) {
  const [showResolved, setShowResolved] = useState(false);
  const hasResolved = comments.some((comment) => comment.resolved);

  const sortedComments = useMemo(
    () => [...comments].sort((a, b) => a.startLine - b.startLine),
    [comments],
  );

  const visibleComments = sortedComments.filter(
    (comment) => !comment.resolved || showResolved,
  );

  return (
    <div data-testid="comments-sidebar" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          Comments ({comments.length})
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close comments"
        >
          <X className="size-3" />
        </Button>
      </div>

      {hasResolved && (
        <label className="text-muted-foreground flex items-center gap-2 border-b px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Show resolved
        </label>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {visibleComments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No comments</p>
          ) : (
            visibleComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                onScrollToLine={onScrollToLine}
                onResolve={onResolve}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onAttachToChat={onAttachToChat}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
