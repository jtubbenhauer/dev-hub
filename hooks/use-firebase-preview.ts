"use client";

import { useMemo } from "react";
import { useGitStatus, useWorkspaceGitHub } from "@/hooks/use-git";
import { useWorkspacePr, useGitHubIssueComments } from "@/hooks/use-github";
import {
  parseFirebasePreviewComment,
  type FirebasePreview,
} from "@/lib/firebase-preview";
import type { GitHubPullRequest } from "@/types";

export interface UseFirebasePreviewResult {
  preview: FirebasePreview | null;
  pr: GitHubPullRequest | null;
  isLoading: boolean;
}

export function useFirebasePreview(
  workspaceId: string | null,
): UseFirebasePreviewResult {
  const gitStatusQuery = useGitStatus(workspaceId);
  const github = useWorkspaceGitHub(workspaceId);

  const owner = github?.owner ?? null;
  const repo = github?.repo ?? null;
  const branch = gitStatusQuery.data?.branch ?? null;

  const prQuery = useWorkspacePr(owner, repo, branch);
  const prNumber = prQuery.data?.number ?? null;

  const commentsQuery = useGitHubIssueComments(owner, repo, prNumber);

  const preview = useMemo(() => {
    if (!commentsQuery.data) return null;
    for (const comment of commentsQuery.data) {
      const parsed = parseFirebasePreviewComment(
        comment.body,
        comment.updated_at,
      );
      if (parsed) return parsed;
    }
    return null;
  }, [commentsQuery.data]);

  const isLoading =
    gitStatusQuery.isLoading || prQuery.isLoading || commentsQuery.isLoading;

  return {
    preview,
    pr: prQuery.data ?? null,
    isLoading,
  };
}
