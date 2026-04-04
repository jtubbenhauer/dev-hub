import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchPrContext,
  formatPrContextForAI,
  type PrContext,
  type PrSummary,
  type PrFile,
} from "@/lib/pr-context";

const mockPrSummary: PrSummary = {
  number: 123,
  title: "Fix user authentication bug",
  state: "open",
  draft: false,
  merge_commit_sha: null,
  user: { login: "johndoe" },
  head: { ref: "fix/auth-bug" },
  base: { ref: "main" },
};

const mockFiles: PrFile[] = [
  {
    filename: "src/auth.ts",
    status: "modified",
    additions: 10,
    deletions: 5,
    changes: 15,
  },
  {
    filename: "src/utils.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    changes: 4,
  },
  {
    filename: "tests/auth.test.ts",
    status: "modified",
    additions: 20,
    deletions: 0,
    changes: 20,
  },
];

const smallDiff = "diff --git a/src/auth.ts b/src/auth.ts\n+added line\n";

function makeJsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function makeDiffResponse(text: string) {
  return {
    ok: true,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => text,
  };
}

function makeErrorResponse() {
  return { ok: false, status: 500, text: async () => "error" };
}

describe("fetchPrContext", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("returns complete PrContext with pr, files, diff, truncated: false for small diff", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    const ctx = await fetchPrContext("owner", "repo", 123);

    expect(ctx.pr).toEqual(mockPrSummary);
    expect(ctx.files).toEqual(mockFiles);
    expect(ctx.diff).toBe(smallDiff);
    expect(ctx.truncated).toBe(false);
  });

  it("fetches PR metadata from the correct URL", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    await fetchPrContext("myorg", "myrepo", 42);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/repos/myorg/myrepo/pulls/42",
    );
  });

  it("fetches files list with per_page=10 from the correct URL", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    await fetchPrContext("myorg", "myrepo", 42);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/repos/myorg/myrepo/pulls/42/files?per_page=10",
    );
  });

  it("fetches diff with Accept: application/vnd.github.v3.diff header", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    await fetchPrContext("myorg", "myrepo", 42);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/repos/myorg/myrepo/pulls/42",
      { headers: { Accept: "application/vnd.github.v3.diff" } },
    );
  });

  it("truncates diff at 50KB clean line boundary and sets truncated: true", async () => {
    const maxBytes = 50 * 1024;
    // Build a diff that's just over 50KB with newlines to test clean boundary
    const line = "x".repeat(100) + "\n";
    const repeatCount = Math.ceil((maxBytes + 500) / line.length);
    const largeDiff = line.repeat(repeatCount);

    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(largeDiff));

    const ctx = await fetchPrContext("owner", "repo", 1);

    expect(ctx.truncated).toBe(true);
    expect(ctx.diff).toBeDefined();
    expect(ctx.diff!.length).toBeLessThanOrEqual(maxBytes);
  });

  it("truncates diff at a newline boundary (not mid-line)", async () => {
    const maxBytes = 50 * 1024;
    // Construct diff where truncation would land mid-line without clean boundary logic
    const prefix = "a".repeat(maxBytes - 5) + "\n";
    const suffix = "b".repeat(20); // no newline — mid-line after truncation point
    const largeDiff = prefix + suffix;

    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(largeDiff));

    const ctx = await fetchPrContext("owner", "repo", 1);

    expect(ctx.truncated).toBe(true);
    // The truncated diff should end at a newline (last char should be \n or the clean cut)
    expect(ctx.diff!.endsWith("\n") || !ctx.diff!.includes("b")).toBe(true);
  });

  it("returns diff: undefined and truncated: false when diff fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeErrorResponse());

    const ctx = await fetchPrContext("owner", "repo", 1);

    expect(ctx.diff).toBeUndefined();
    expect(ctx.truncated).toBe(false);
  });

  it("returns diff: undefined and truncated: false when diff fetch throws", async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockRejectedValueOnce(new Error("network error"));

    const ctx = await fetchPrContext("owner", "repo", 1);

    expect(ctx.diff).toBeUndefined();
    expect(ctx.truncated).toBe(false);
  });

  it("caps files at 10 even if API returns more", async () => {
    const manyFiles: PrFile[] = Array.from({ length: 15 }, (_, i) => ({
      filename: `file${i}.ts`,
      status: "modified",
      additions: i,
      deletions: 0,
      changes: i,
    }));

    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(mockPrSummary))
      .mockResolvedValueOnce(makeJsonResponse(manyFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    const ctx = await fetchPrContext("owner", "repo", 1);

    expect(ctx.files).toHaveLength(10);
  });

  it("extracts minimal PrSummary fields from full API response", async () => {
    const fullApiResponse = {
      ...mockPrSummary,
      body: "long body text",
      html_url: "https://github.com/...",
      created_at: "2024-01-01",
      extra_field: "ignored",
    };

    mockFetch
      .mockResolvedValueOnce(makeJsonResponse(fullApiResponse))
      .mockResolvedValueOnce(makeJsonResponse(mockFiles))
      .mockResolvedValueOnce(makeDiffResponse(smallDiff));

    const ctx = await fetchPrContext("owner", "repo", 123);

    expect(ctx.pr.number).toBe(123);
    expect(ctx.pr.title).toBe("Fix user authentication bug");
    expect(ctx.pr.user.login).toBe("johndoe");
  });
});

describe("formatPrContextForAI", () => {
  const baseContext: PrContext = {
    pr: mockPrSummary,
    files: mockFiles,
    diff: smallDiff,
    truncated: false,
  };

  it("includes PR number and title in output", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("PR #123: Fix user authentication bug");
  });

  it("includes status: open for open non-draft PR", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("Status: open");
  });

  it("shows status: draft for draft PR", () => {
    const ctx: PrContext = {
      ...baseContext,
      pr: { ...mockPrSummary, draft: true },
    };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("Status: draft");
  });

  it("shows status: merged when merge_commit_sha is set", () => {
    const ctx: PrContext = {
      ...baseContext,
      pr: { ...mockPrSummary, state: "closed", merge_commit_sha: "abc123" },
    };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("Status: merged");
  });

  it("shows status: closed for closed non-merged PR", () => {
    const ctx: PrContext = {
      ...baseContext,
      pr: { ...mockPrSummary, state: "closed", merge_commit_sha: null },
    };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("Status: closed");
  });

  it("includes author login", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("Author: johndoe");
  });

  it("includes branch info with arrow", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("Branch: fix/auth-bug → main");
  });

  it("includes changed files section with count", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("Changed files (3):");
  });

  it("includes file names with change stats", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("src/auth.ts (+10 -5)");
    expect(output).toContain("src/utils.ts (+3 -1)");
    expect(output).toContain("tests/auth.test.ts (+20 -0)");
  });

  it("includes diff when provided", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).toContain("Diff:");
    expect(output).toContain(smallDiff);
  });

  it("shows [no diff available] when diff is undefined", () => {
    const ctx: PrContext = { ...baseContext, diff: undefined };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("[no diff available]");
  });

  it("shows truncation note when truncated: true", () => {
    const ctx: PrContext = { ...baseContext, truncated: true };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("[truncated");
  });

  it("does NOT show truncation note when truncated: false", () => {
    const output = formatPrContextForAI(baseContext);
    expect(output).not.toContain("[truncated");
  });

  it("shows empty files section when no files", () => {
    const ctx: PrContext = { ...baseContext, files: [] };
    const output = formatPrContextForAI(ctx);
    expect(output).toContain("Changed files (0):");
  });
});
