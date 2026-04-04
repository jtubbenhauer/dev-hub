"use client";

import { cn } from "@/lib/utils";
import { useGitHubPr } from "@/hooks/use-github";

interface PrBadgeProps {
  prNumber: number;
  owner: string;
  repo: string;
}

function getPrStatusClass(
  state: "open" | "closed",
  draft: boolean,
  mergeCommitSha: string | null,
): string {
  if (draft) return "bg-gray-400";
  if (mergeCommitSha) return "bg-purple-500";
  if (state === "closed") return "bg-red-500";
  return "bg-green-500";
}

function truncateTitle(title: string): string {
  if (title.length <= 60) return title;
  return title.slice(0, 60) + "...";
}

export function PrBadge({ prNumber, owner, repo }: PrBadgeProps) {
  const { data: pr, isLoading, isError } = useGitHubPr(owner, repo, prNumber);

  if (isLoading || isError || !pr) {
    return <span className="text-[11px]">#{prNumber}</span>;
  }

  const statusClass = getPrStatusClass(pr.state, pr.draft, pr.merge_commit_sha);
  const displayTitle = truncateTitle(pr.title);
  const githubUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

  return (
    <a
      href={githubUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${pr.title} (${pr.head.ref})`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight",
        "border-primary/20 bg-primary/5 text-foreground",
        "hover:bg-primary/10 cursor-pointer transition-colors",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", statusClass)} />
      <span className="text-muted-foreground font-medium">#{prNumber}</span>
      <span>{displayTitle}</span>
      <span className="text-muted-foreground">by {pr.user.login}</span>
    </a>
  );
}
