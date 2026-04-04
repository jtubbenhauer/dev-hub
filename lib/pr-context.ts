export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface PrSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merge_commit_sha: string | null;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
}

export interface PrContext {
  pr: PrSummary;
  files: PrFile[];
  diff: string | undefined;
  truncated: boolean;
}

const PR_DIFF_MAX_BYTES = 50 * 1024;
const PR_FILES_CAP = 10;

function truncateDiff(
  diff: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (diff.length <= maxBytes) return { text: diff, truncated: false };
  const sliced = diff.slice(0, maxBytes);
  const lastNewline = sliced.lastIndexOf("\n");
  const cleanTruncated =
    lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  return { text: cleanTruncated, truncated: true };
}

function resolvePrStatus(pr: PrSummary): string {
  if (pr.draft) return "draft";
  if (pr.merge_commit_sha) return "merged";
  if (pr.state === "closed") return "closed";
  return "open";
}

export async function fetchPrContext(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrContext> {
  const base = `/api/github/repos/${owner}/${repo}/pulls/${prNumber}`;

  const [prRes, filesRes] = await Promise.all([
    fetch(base),
    fetch(`${base}/files?per_page=${PR_FILES_CAP}`),
  ]);

  const prData = (await prRes.json()) as PrSummary;
  const filesData = (await filesRes.json()) as PrFile[];

  const pr: PrSummary = {
    number: prData.number,
    title: prData.title,
    state: prData.state,
    draft: prData.draft,
    merge_commit_sha: prData.merge_commit_sha,
    user: { login: prData.user.login },
    head: { ref: prData.head.ref },
    base: { ref: prData.base.ref },
  };

  const files = filesData.slice(0, PR_FILES_CAP);

  let diff: string | undefined;
  let truncated = false;

  try {
    const diffRes = await fetch(base, {
      headers: { Accept: "application/vnd.github.v3.diff" },
    });
    if (diffRes.ok) {
      const rawDiff = await diffRes.text();
      const result = truncateDiff(rawDiff, PR_DIFF_MAX_BYTES);
      diff = result.text;
      truncated = result.truncated;
    }
  } catch {
    diff = undefined;
    truncated = false;
  }

  return { pr, files, diff, truncated };
}

export function formatPrContextForAI(context: PrContext): string {
  const { pr, files, diff, truncated } = context;
  const status = resolvePrStatus(pr);

  const lines: string[] = [
    `PR #${pr.number}: ${pr.title}`,
    `Status: ${status}`,
    `Author: ${pr.user.login}`,
    `Branch: ${pr.head.ref} → ${pr.base.ref}`,
    "",
    `Changed files (${files.length}):`,
    ...files.map((f) => `- ${f.filename} (+${f.additions} -${f.deletions})`),
    "",
    "Diff:",
    diff !== undefined ? diff : "[no diff available]",
  ];

  if (truncated) {
    lines.push("[truncated — diff exceeded 50KB limit]");
  }

  return lines.join("\n");
}
