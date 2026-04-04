export interface PrReference {
  number: number;
  startIndex: number;
  endIndex: number;
}

export interface GitHubPr {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  merge_commit_sha?: string | null;
}

const PR_DIFF_MAX_BYTES = 50 * 1024;

export function parsePrReferences(text: string): PrReference[] {
  const pattern = /(?:^|\s)(#(\d+))/g;
  const refs: PrReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const hashAndNumber = match[1];
    const digits = match[2];
    const matchStart = match.index;
    const prefixLength = fullMatch.length - hashAndNumber.length;
    const startIndex = matchStart + prefixLength;
    const endIndex = startIndex + hashAndNumber.length;

    refs.push({
      number: parseInt(digits, 10),
      startIndex,
      endIndex,
    });
  }

  return refs;
}

export function isPrTrigger(textBeforeCursor: string): {
  triggered: boolean;
  query: string;
} {
  const notTriggered = { triggered: false, query: "" };

  const triggerMatch = /(^|\s)(#(\d*))$/.exec(textBeforeCursor);
  if (!triggerMatch) return notTriggered;

  const afterHash = triggerMatch[3];
  return { triggered: true, query: afterHash };
}

function resolvePrStatus(pr: GitHubPr): string {
  if (pr.draft) return "draft";
  if (pr.merge_commit_sha) return "merged";
  if (pr.state === "closed") return "closed";
  return "open";
}

export function formatPrContext(pr: GitHubPr, diff?: string): string {
  const status = resolvePrStatus(pr);
  const lines: string[] = [
    `PR #${pr.number}: ${pr.title}`,
    `Status: ${status}`,
    `Author: ${pr.user.login}`,
    `Branch: ${pr.head.ref} → ${pr.base.ref}`,
  ];

  if (diff !== undefined) {
    const truncatedDiff =
      diff.length > PR_DIFF_MAX_BYTES
        ? diff.slice(0, PR_DIFF_MAX_BYTES) + "\n[truncated]"
        : diff;
    lines.push("", truncatedDiff);
  }

  return lines.join("\n");
}
