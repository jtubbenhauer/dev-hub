import type { ContentSearchQuery } from "./types";

export const CONTENT_SEARCH_DEFAULT_MAX_RESULTS = 2000;
export const CONTENT_SEARCH_MAX_RESULTS_LIMIT = 5000;
export const CONTENT_SEARCH_MAX_PATTERN_LENGTH = 1000;
export const CONTENT_SEARCH_MAX_GLOBS = 20;
export const CONTENT_SEARCH_MAX_GLOB_LENGTH = 200;

export type ContentSearchParamsResult =
  | { readonly kind: "ok"; readonly query: ContentSearchQuery }
  | { readonly kind: "invalid"; readonly message: string };

export function buildContentSearchParams(
  query: ContentSearchQuery,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("pattern", query.pattern);
  if (query.isRegex) params.set("regex", "1");
  if (query.isCaseSensitive) params.set("caseSensitive", "1");
  if (query.isWholeWord) params.set("wholeWord", "1");
  for (const glob of query.includeGlobs) params.append("include", glob);
  for (const glob of query.excludeGlobs) params.append("exclude", glob);
  params.set("max", String(query.maxResults));
  return params;
}

function cleanGlobs(globs: readonly string[]): string[] {
  return globs.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
}

function parseMaxResults(rawMax: string | null): number {
  const parsedMax = Number.parseInt(rawMax ?? "", 10);
  const requestedMax = Number.isNaN(parsedMax)
    ? CONTENT_SEARCH_DEFAULT_MAX_RESULTS
    : parsedMax;
  return Math.min(Math.max(requestedMax, 1), CONTENT_SEARCH_MAX_RESULTS_LIMIT);
}

export function parseContentSearchParams(
  params: URLSearchParams,
): ContentSearchParamsResult {
  const pattern = params.get("pattern") ?? "";
  if (pattern.includes("\n") || pattern.includes("\r")) {
    return { kind: "invalid", message: "Search text must be a single line" };
  }
  if (pattern.length > CONTENT_SEARCH_MAX_PATTERN_LENGTH) {
    return {
      kind: "invalid",
      message: `Search text is too long (max ${CONTENT_SEARCH_MAX_PATTERN_LENGTH} characters)`,
    };
  }

  const includeGlobs = cleanGlobs(params.getAll("include"));
  const excludeGlobs = cleanGlobs(params.getAll("exclude"));
  if (
    includeGlobs.length > CONTENT_SEARCH_MAX_GLOBS ||
    excludeGlobs.length > CONTENT_SEARCH_MAX_GLOBS
  ) {
    return {
      kind: "invalid",
      message: `Too many file patterns (max ${CONTENT_SEARCH_MAX_GLOBS})`,
    };
  }
  const hasOversizedGlob = [...includeGlobs, ...excludeGlobs].some(
    (glob) => glob.length > CONTENT_SEARCH_MAX_GLOB_LENGTH,
  );
  if (hasOversizedGlob) {
    return {
      kind: "invalid",
      message: `File pattern is too long (max ${CONTENT_SEARCH_MAX_GLOB_LENGTH} characters)`,
    };
  }

  return {
    kind: "ok",
    query: {
      pattern,
      isRegex: params.get("regex") === "1",
      isCaseSensitive: params.get("caseSensitive") === "1",
      isWholeWord: params.get("wholeWord") === "1",
      includeGlobs,
      excludeGlobs,
      maxResults: parseMaxResults(params.get("max")),
    },
  };
}

export function splitGlobList(text: string): string[] {
  return cleanGlobs(text.split(","));
}
