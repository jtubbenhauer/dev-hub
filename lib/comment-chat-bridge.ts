const STORAGE_KEY = "devhub:pending-comment-chips"

type CommentChip = {
  id: number
  filePath: string
  startLine: number
  endLine: number
  body: string
}

export function attachCommentToChat(comment: CommentChip): void {
  const existing = getPendingCommentChips()
  if (existing.some((c) => c.id === comment.id)) return
  const updated = [...existing, comment]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  window.dispatchEvent(new CustomEvent("attach-comment-to-chat"))
}

export function getPendingCommentChips(): CommentChip[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CommentChip[]) : []
  } catch {
    return []
  }
}

export function clearPendingCommentChips(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function removePendingCommentChip(id: number): void {
  const updated = getPendingCommentChips().filter((c) => c.id !== id)
  if (updated.length === 0) {
    clearPendingCommentChips()
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }
}
