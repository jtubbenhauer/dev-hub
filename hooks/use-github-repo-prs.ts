"use client";

import { useQuery } from "@tanstack/react-query";

interface RepoPr {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  user: { login: string; avatar_url: string };
  head: { ref: string };
}

async function githubFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/github/${path}`, options);
  if (!res.ok) {
    let message = `GitHub API error (${res.status})`;
    try {
      const err = await res.json();
      if (err.message) message = err.message;
      else if (err.error) message = err.error;
    } catch (_err) {
      void _err;
    }
    throw new Error(message);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

interface UseGitHubRepoPrsOptions {
  state?: "open" | "closed" | "all";
  search?: string;
}

export function useGitHubRepoPrs(
  owner: string,
  repo: string,
  options?: UseGitHubRepoPrsOptions,
) {
  const state = options?.state ?? "open";
  const search = options?.search;

  return useQuery<RepoPr[]>({
    queryKey: ["github", "repo-prs", owner, repo, state],
    queryFn: async () => {
      const prs = await githubFetch<RepoPr[]>(
        `repos/${owner}/${repo}/pulls?state=${state}&per_page=20`,
      );
      return prs.slice(0, 20);
    },
    select: (data) => {
      if (!search) return data;
      const lowerSearch = search.toLowerCase();
      return data.filter(
        (pr) =>
          pr.title.toLowerCase().includes(lowerSearch) ||
          String(pr.number).startsWith(search),
      );
    },
    enabled: !!(owner && repo),
    staleTime: 30_000,
  });
}
