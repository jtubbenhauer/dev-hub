import { useQuery } from "@tanstack/react-query";
import {
  GITHUB_AUTH_STATUS_QUERY_KEY,
  type GitHubAuthStatus,
} from "@/lib/github/github-auth-status";

export async function fetchGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const response = await fetch("/api/github-auth");
  if (!response.ok) {
    throw new Error(`Couldn't check the GitHub login (${response.status})`);
  }
  return (await response.json()) as GitHubAuthStatus;
}

export function useGitHubAuthStatus() {
  return useQuery<GitHubAuthStatus>({
    queryKey: GITHUB_AUTH_STATUS_QUERY_KEY,
    queryFn: fetchGitHubAuthStatus,
    staleTime: 30_000,
  });
}
