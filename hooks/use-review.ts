"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  ReviewWithFiles,
  Review,
  ReviewCreateInput,
  AllBranch,
} from "@/types"

async function reviewGet<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Review operation failed")
  }
  return res.json()
}

async function reviewPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Review operation failed")
  }
  return res.json()
}

async function reviewDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Delete failed")
  }
}

export function useReviewList(workspaceId: string | null) {
  return useQuery<Review[]>({
    queryKey: ["reviews", workspaceId],
    queryFn: () => reviewGet<Review[]>(`/api/reviews?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  })
}

export function useReview(reviewId: string | null) {
  return useQuery<ReviewWithFiles>({
    queryKey: ["review", reviewId],
    queryFn: () => reviewGet<ReviewWithFiles>(`/api/reviews/${reviewId}`),
    enabled: !!reviewId,
  })
}

export function useReviewBranches(workspaceId: string | null) {
  return useQuery<AllBranch[]>({
    queryKey: ["review-branches", workspaceId],
    queryFn: () => reviewGet<AllBranch[]>(`/api/reviews?workspaceId=${workspaceId}&action=branches`),
    enabled: !!workspaceId,
  })
}

export function useReviewDiff(reviewId: string | null, fileId: number | null) {
  return useQuery<{ diff: string; path: string }>({
    queryKey: ["review-diff", reviewId, fileId],
    queryFn: () =>
      reviewGet<{ diff: string; path: string }>(
        `/api/reviews/${reviewId}/diff?fileId=${fileId}`
      ),
    enabled: !!reviewId && fileId !== null,
  })
}

export function useCreateReview() {
  const queryClient = useQueryClient()

  return useMutation<ReviewWithFiles, Error, ReviewCreateInput>({
    mutationFn: (input) =>
      reviewPost<ReviewWithFiles>("/api/reviews", input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["reviews", data.workspaceId] })
      toast.success("Review created")
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useDeleteReview(workspaceId: string | null) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: (reviewId) => reviewDelete(`/api/reviews/${reviewId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews", workspaceId] })
      toast.success("Review deleted")
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useToggleReviewFile(reviewId: string | null) {
  const queryClient = useQueryClient()

  return useMutation<
    { ok: boolean; reviewedFiles: number },
    Error,
    { fileId: number; reviewed: boolean }
  >({
    mutationFn: (body) =>
      reviewPost<{ ok: boolean; reviewedFiles: number }>(
        `/api/reviews/${reviewId}/files`,
        body
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", reviewId] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useRefreshReview(reviewId: string | null) {
  const queryClient = useQueryClient()

  return useMutation<ReviewWithFiles & { staleCount: number }, Error, void>({
    mutationFn: () =>
      reviewPost<ReviewWithFiles & { staleCount: number }>(
        `/api/reviews/${reviewId}/refresh`,
        {}
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["review", reviewId] })
      if (data.staleCount > 0) {
        toast.warning(`${data.staleCount} file(s) changed — auto-unreviewed`)
      }
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}
