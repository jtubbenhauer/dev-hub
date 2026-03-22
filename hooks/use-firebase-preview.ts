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
  previews: FirebasePreview[];
  pr: GitHubPullRequest | null;
  isLoading: boolean;
  owner: string | null;
  repo: string | null;
  branch: string | null;
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

  const previews = useMemo(() => {
    if (!commentsQuery.data) return [];
    const results: FirebasePreview[] = [];
    for (const comment of commentsQuery.data) {
      const parsed = parseFirebasePreviewComment(
        comment.body,
        comment.updated_at,
      );
      if (parsed) results.push(parsed);
    }
    return results;
  }, [commentsQuery.data]);

  const isLoading =
    gitStatusQuery.isLoading || prQuery.isLoading || commentsQuery.isLoading;

  return {
    previews,
    pr: prQuery.data ?? null,
    isLoading,
    owner,
    repo,
    branch,
  };
}
