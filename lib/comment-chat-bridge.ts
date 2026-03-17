const STORAGE_KEY_PREFIX = "devhub:pending-comment-chips"

function storageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceId}`
}

export type CommentChip = {
  id: number
  filePath: string
  startLine: number
  endLine: number
  body: string
  workspaceId: string
  sessionId: string | null
}

export function attachCommentToChat(comment: CommentChip): void {
  const key = storageKey(comment.workspaceId)
  const existing = getPendingCommentChips(comment.workspaceId)
  if (existing.some((c) => c.id === comment.id)) return
  const updated = [...existing, comment]
  localStorage.setItem(key, JSON.stringify(updated))
  window.dispatchEvent(new CustomEvent("attach-comment-to-chat"))
}

export function getPendingCommentChips(workspaceId: string): CommentChip[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    return raw ? (JSON.parse(raw) as CommentChip[]) : []
  } catch {
    return []
  }
}

export function clearPendingCommentChips(workspaceId: string): void {
  localStorage.removeItem(storageKey(workspaceId))
}

export type CommentRef = {
  id: number
  filePath: string
  lineRef: string
  body: string
}

const COMMENT_BLOCK_RE = /^Comment references:\n([\s\S]*?)(?:\n\n|$)/
const COMMENT_LINE_RE = /^- \[comment:(\d+)\] (\S+?) — "(.+)"$/gm

export function parseCommentRefs(text: string): { refs: CommentRef[]; cleanedText: string } {
  const match = COMMENT_BLOCK_RE.exec(text)
  if (!match) return { refs: [], cleanedText: text }

  const refs: CommentRef[] = []
  const block = match[1]
  for (const line of block.matchAll(COMMENT_LINE_RE)) {
    const lineRef = line[2]
    const filePath = lineRef.replace(/:\d+(-\d+)?$/, "")
    refs.push({ id: Number(line[1]), filePath, lineRef, body: line[3] })
  }

  const cleanedText = text.slice(match[0].length).trim()
  return { refs, cleanedText }
}

export function detachCommentFromChat(commentId: number): void {
  window.dispatchEvent(new CustomEvent("detach-comment-from-chat", { detail: { commentId } }))
}

export function updateCommentInChat(commentId: number, body: string): void {
  window.dispatchEvent(new CustomEvent("update-comment-in-chat", { detail: { commentId, body } }))
}

export function getAllCachedComments(
  queryClient: { getQueriesData: <T>(opts: { queryKey: readonly unknown[] }) => [readonly unknown[], T | undefined][] },
  workspaceId: string
): { id: number; resolved: boolean }[] {
  const entries = queryClient.getQueriesData<{ id: number; resolved: boolean }[]>({
    queryKey: ["file-comments", workspaceId],
  })
  const all: { id: number; resolved: boolean }[] = []
  for (const [, data] of entries) {
    if (Array.isArray(data)) {
      for (const c of data) all.push(c)
    }
  }
  return all
}

export function removePendingCommentChip(workspaceId: string, id: number): void {
  const updated = getPendingCommentChips(workspaceId).filter((c) => c.id !== id)
  if (updated.length === 0) {
    clearPendingCommentChips(workspaceId)
  } else {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(updated))
  }
}
