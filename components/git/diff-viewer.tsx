"use client"

import { useState, useMemo } from "react"
import { Plus, MessageCircle } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFileComments, useCreateFileComment, useResolveFileComment, useDeleteFileComment, useUpdateFileComment } from "@/hooks/use-file-comments"
import { CommentThread } from "@/components/editor/comment-thread"
import { CommentInput } from "@/components/editor/comment-input"
import { attachCommentToChat } from "@/lib/comment-chat-bridge"
import type { FileComment } from "@/types"

interface DiffViewerProps {
  diff: string
  fileName?: string
  isLoading?: boolean
  workspaceId?: string
}

interface HoveredLine {
  lineNumber: number
  filePath: string
}

interface CommentInputLine {
  startLine: number
  endLine: number
  filePath: string
  contentSnapshot: string
}

interface ActiveCommentLine {
  lineNumber: number
  filePath: string
}

export function DiffViewer({ diff, fileName, isLoading, workspaceId }: DiffViewerProps) {
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null)
  const [commentInputLine, setCommentInputLine] = useState<CommentInputLine | null>(null)
  const [activeCommentLine, setActiveCommentLine] = useState<ActiveCommentLine | null>(null)

  const lines = useMemo(() => parseDiffLines(diff), [diff])

  const uniqueFilePaths = useMemo(
    () => Array.from(new Set(lines.map((l) => l.filePath).filter(Boolean) as string[])),
    [lines]
  )

  const allCommentsMap = useAllComments(workspaceId ?? null, uniqueFilePaths)

  const createComment = useCreateFileComment()
  const resolveComment = useResolveFileComment()
  const deleteComment = useDeleteFileComment()
  const updateComment = useUpdateFileComment()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading diff...
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {fileName ? "No changes" : "Select a file to view diff"}
      </div>
    )
  }

  function getLineKey(filePath: string, lineNumber: number): string {
    return `${filePath}:${lineNumber}`
  }

  function getCommentsForLine(filePath: string, lineNumber: number): FileComment[] {
    const key = getLineKey(filePath, lineNumber)
    return allCommentsMap[key] ?? []
  }

  function handleLineMouseEnter(lineNumber: number, filePath: string) {
    setHoveredLine({ lineNumber, filePath })
  }

  function handleLineMouseLeave() {
    setHoveredLine(null)
  }

  function handleAddCommentClick(lineNumber: number, filePath: string, content: string) {
    setCommentInputLine({ startLine: lineNumber, endLine: lineNumber, filePath, contentSnapshot: content })
    setHoveredLine(null)
  }

  function handleCommentSubmit(body: string) {
    if (!commentInputLine || !workspaceId) return
    createComment.mutate({
      workspaceId,
      filePath: commentInputLine.filePath,
      startLine: commentInputLine.startLine,
      endLine: commentInputLine.endLine,
      body,
      contentSnapshot: commentInputLine.contentSnapshot,
    })
    setCommentInputLine(null)
  }

  function handleCommentCancel() {
    setCommentInputLine(null)
  }

  function handleToggleCommentThread(lineNumber: number, filePath: string) {
    const isSame =
      activeCommentLine?.lineNumber === lineNumber &&
      activeCommentLine?.filePath === filePath
    setActiveCommentLine(isSame ? null : { lineNumber, filePath })
  }

  function handleAttachToChat(comment: FileComment) {
    attachCommentToChat({
      id: comment.id,
      filePath: comment.filePath,
      startLine: comment.startLine,
      endLine: comment.endLine,
      body: comment.body,
    })
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      {fileName && (
        <div className="sticky top-0 z-10 border-b bg-muted/50 px-3 py-1.5 text-xs font-mono text-muted-foreground">
          {fileName}
        </div>
      )}
      <div className="font-mono text-xs leading-5">
        {lines.map((line, index) => {
          const lineNumber = line.newLineNumber ?? line.oldLineNumber
          const canComment = !!workspaceId && !!line.filePath && lineNumber !== null && line.type !== "header" && line.type !== "hunk"
          const isHovered = canComment && hoveredLine?.lineNumber === lineNumber && hoveredLine?.filePath === line.filePath
          const lineComments = canComment && lineNumber !== null && line.filePath
            ? getCommentsForLine(line.filePath, lineNumber)
            : []
          const hasComments = lineComments.length > 0
          const isCommentInputOpen =
            commentInputLine?.startLine === lineNumber &&
            commentInputLine?.filePath === line.filePath
          const isCommentThreadOpen =
            activeCommentLine?.lineNumber === lineNumber &&
            activeCommentLine?.filePath === line.filePath

          return (
            <div key={index}>
              <div
                data-diff-line
                className={cn(
                  "group relative flex",
                  line.type === "addition" && "bg-green-500/10",
                  line.type === "deletion" && "bg-red-500/10",
                  line.type === "hunk" && "bg-blue-500/10 text-blue-400"
                )}
                onMouseEnter={
                  canComment && lineNumber !== null && line.filePath
                    ? () => handleLineMouseEnter(lineNumber, line.filePath!)
                    : undefined
                }
                onMouseLeave={canComment ? handleLineMouseLeave : undefined}
              >
                <span className="w-12 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/50">
                  {line.oldLineNumber ?? ""}
                </span>
                <span className="w-12 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/50">
                  {line.newLineNumber ?? ""}
                </span>
                <span
                  className={cn(
                    "w-5 shrink-0 select-none text-center",
                    line.type === "addition" && "text-green-500",
                    line.type === "deletion" && "text-red-500",
                    line.type === "hunk" && "text-blue-400"
                  )}
                >
                  {line.prefix}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all px-1">
                  {line.content}
                </span>
                {canComment && lineNumber !== null && line.filePath && (
                  <span className="flex shrink-0 items-center gap-0.5 pr-1">
                    {hasComments && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="View comments"
                        title="View comments"
                        onClick={() => handleToggleCommentThread(lineNumber, line.filePath!)}
                        className="size-4 text-blue-400 hover:text-blue-300"
                      >
                        <MessageCircle className="size-3" />
                      </Button>
                    )}
                    {isHovered && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Add comment"
                        title="Add comment"
                        onClick={() => handleAddCommentClick(lineNumber, line.filePath!, line.content)}
                        className="size-4"
                      >
                        <Plus className="size-3" />
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {isCommentInputOpen && commentInputLine && (
                <div className="mx-2 mb-1">
                  <CommentInput
                    startLine={commentInputLine.startLine}
                    endLine={commentInputLine.endLine}
                    filePath={commentInputLine.filePath}
                    onSubmit={handleCommentSubmit}
                    onCancel={handleCommentCancel}
                  />
                </div>
              )}
              {isCommentThreadOpen && lineComments.length > 0 && (
                <div className="mx-2 mb-1">
                  <CommentThread
                    comments={lineComments}
                    onResolve={(id) => resolveComment.mutate({ id, resolved: true })}
                    onDelete={(id) => deleteComment.mutate(id)}
                    onUpdate={(id, body) => updateComment.mutate({ id, body })}
                    onAttachToChat={handleAttachToChat}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

type DiffLineType = "context" | "addition" | "deletion" | "hunk" | "header"

interface DiffLine {
  type: DiffLineType
  content: string
  prefix: string
  oldLineNumber: number | null
  newLineNumber: number | null
  filePath: string | null
}

function parseDiffLines(diff: string): DiffLine[] {
  const rawLines = diff.split("\n")
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let currentFilePath: string | null = null

  for (const raw of rawLines) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({
        type: "hunk",
        content: raw,
        prefix: "@@",
        oldLineNumber: null,
        newLineNumber: null,
        filePath: currentFilePath,
      })
    } else if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++")) {
      if (raw.startsWith("diff ")) {
        currentFilePath = raw.match(/^diff --git a\/.+ b\/(.+)$/)?.[1] ?? null
      }
      result.push({
        type: "header",
        content: raw,
        prefix: "",
        oldLineNumber: null,
        newLineNumber: null,
        filePath: currentFilePath,
      })
    } else if (raw.startsWith("+")) {
      result.push({
        type: "addition",
        content: raw.slice(1),
        prefix: "+",
        oldLineNumber: null,
        newLineNumber: newLine,
        filePath: currentFilePath,
      })
      newLine++
    } else if (raw.startsWith("-")) {
      result.push({
        type: "deletion",
        content: raw.slice(1),
        prefix: "-",
        oldLineNumber: oldLine,
        newLineNumber: null,
        filePath: currentFilePath,
      })
      oldLine++
    } else if (raw.startsWith(" ")) {
      result.push({
        type: "context",
        content: raw.slice(1),
        prefix: " ",
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        filePath: currentFilePath,
      })
      oldLine++
      newLine++
    } else if (raw === "\\ No newline at end of file") {
      result.push({
        type: "context",
        content: raw,
        prefix: "",
        oldLineNumber: null,
        newLineNumber: null,
        filePath: currentFilePath,
      })
    }
  }

  return result
}

function useAllComments(
  workspaceId: string | null,
  filePaths: string[]
): Record<string, FileComment[]> {
  const path0 = filePaths[0] ?? null
  const path1 = filePaths[1] ?? null
  const path2 = filePaths[2] ?? null
  const path3 = filePaths[3] ?? null
  const path4 = filePaths[4] ?? null

  const q0 = useFileComments(workspaceId, path0 ?? undefined)
  const q1 = useFileComments(workspaceId, path1 ?? undefined)
  const q2 = useFileComments(workspaceId, path2 ?? undefined)
  const q3 = useFileComments(workspaceId, path3 ?? undefined)
  const q4 = useFileComments(workspaceId, path4 ?? undefined)

  const seen = new Set<number>()
  const allComments: FileComment[] = []
  for (const c of [
    ...(q0.data ?? []),
    ...(q1.data ?? []),
    ...(q2.data ?? []),
    ...(q3.data ?? []),
    ...(q4.data ?? []),
  ]) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      allComments.push(c)
    }
  }

  const map: Record<string, FileComment[]> = {}
  for (const comment of allComments) {
    const key = `${comment.filePath}:${comment.startLine}`
    if (!map[key]) map[key] = []
    map[key].push(comment)
  }
  return map
}
