"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { FileComment, NewFileComment } from "@/types";
import {
  attachCommentToChat,
  detachCommentFromChat,
  updateCommentInChat,
} from "@/lib/comment-chat-bridge";
import { useChatStore } from "@/stores/chat-store";

async function fileCommentsGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to fetch file comments");
  }
  return res.json();
}

async function fileCommentsPost<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create file comment");
  }
  return res.json();
}

async function fileCommentsPut<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update file comment");
  }
  return res.json();
}

async function fileCommentsDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to delete file comment");
  }
}

export function useFileComments(
  workspaceId: string | null,
  filePath?: string,
  includeResolved?: boolean,
) {
  const searchParams = new URLSearchParams();
  if (workspaceId) searchParams.set("workspaceId", workspaceId);
  if (filePath) searchParams.set("filePath", filePath);
  if (includeResolved !== undefined)
    searchParams.set("includeResolved", String(includeResolved));

  const queryString = searchParams.toString();
  const url = `/api/file-comments${queryString ? `?${queryString}` : ""}`;

  return useQuery<FileComment[]>({
    queryKey: ["file-comments", workspaceId, filePath, includeResolved],
    queryFn: () => fileCommentsGet<FileComment[]>(url),
    enabled: !!workspaceId,
  });
}

export function useCreateFileComment() {
  const queryClient = useQueryClient();
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  return useMutation<FileComment, Error, NewFileComment>({
    mutationFn: (input) =>
      fileCommentsPost<FileComment>("/api/file-comments", input),
    onSuccess: (comment, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-comments"] });
      attachCommentToChat({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        endLine: comment.endLine,
        body: comment.body,
        workspaceId: variables.workspaceId,
        sessionId: activeSessionId,
      });
      toast.success("Comment created");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useUpdateFileComment() {
  const queryClient = useQueryClient();

  return useMutation<FileComment, Error, { id: number; body: string }>({
    mutationFn: ({ id, body }) =>
      fileCommentsPut<FileComment>(`/api/file-comments/${id}`, { body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-comments"] });
      updateCommentInChat(variables.id, variables.body);
      toast.success("Comment updated");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useResolveFileComment() {
  const queryClient = useQueryClient();

  return useMutation<FileComment, Error, { id: number; resolved: boolean }>({
    mutationFn: ({ id, resolved }) =>
      fileCommentsPut<FileComment>(`/api/file-comments/${id}/resolve`, {
        resolved,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-comments"] });
      toast.success(
        variables.resolved ? "Comment resolved" : "Comment reopened",
      );
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteFileComment() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => fileCommentsDelete(`/api/file-comments/${id}`),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["file-comments"] });
      detachCommentFromChat(deletedId);
      toast.success("Comment deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}
