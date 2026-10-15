import { describe, expect, it } from "vitest";
import {
  CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
  CONTENT_SEARCH_MAX_GLOB_LENGTH,
  CONTENT_SEARCH_MAX_GLOBS,
  CONTENT_SEARCH_MAX_PATTERN_LENGTH,
  CONTENT_SEARCH_MAX_RESULTS_LIMIT,
  buildContentSearchParams,
  parseContentSearchParams,
  splitGlobList,
  type ContentSearchQuery,
} from "@devhub/shared";

function makeQuery(
  overrides: Partial<ContentSearchQuery> = {},
): ContentSearchQuery {
  return {
    pattern: "needle",
    isRegex: false,
    isCaseSensitive: false,
    isWholeWord: false,
    includeGlobs: [],
    excludeGlobs: [],
    maxResults: CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
    ...overrides,
  };
}

function parseOk(params: URLSearchParams): ContentSearchQuery {
  const result = parseContentSearchParams(params);
  if (result.kind !== "ok") {
    throw new Error(`expected ok, got invalid: ${result.message}`);
  }
  return result.query;
}

function parseInvalidMessage(params: URLSearchParams): string {
  const result = parseContentSearchParams(params);
  if (result.kind !== "invalid") {
    throw new Error("expected invalid, got ok");
  }
  return result.message;
}

describe("content-search params constants", () => {
  it("exposes the documented limits", () => {
    expect(CONTENT_SEARCH_DEFAULT_MAX_RESULTS).toBe(2000);
    expect(CONTENT_SEARCH_MAX_RESULTS_LIMIT).toBe(5000);
    expect(CONTENT_SEARCH_MAX_PATTERN_LENGTH).toBe(1000);
    expect(CONTENT_SEARCH_MAX_GLOBS).toBe(20);
    expect(CONTENT_SEARCH_MAX_GLOB_LENGTH).toBe(200);
  });
});

describe("buildContentSearchParams", () => {
  it("sets boolean flags only when they are true", () => {
    const params = buildContentSearchParams(makeQuery());

    expect(params.has("regex")).toBe(false);
    expect(params.has("caseSensitive")).toBe(false);
    expect(params.has("wholeWord")).toBe(false);
  });

  it("writes one include and one exclude param per glob", () => {
    const query = makeQuery({
      includeGlobs: ["src/**", "*.ts"],
      excludeGlobs: ["dist/**"],
    });

    const params = buildContentSearchParams(query);

    expect(params.getAll("include")).toEqual(query.includeGlobs);
    expect(params.getAll("exclude")).toEqual(query.excludeGlobs);
  });
});

describe("parseContentSearchParams", () => {
  it("round-trips a query with every option set", () => {
    const query = makeQuery({
      pattern: "  foo(bar)  ",
      isRegex: true,
      isCaseSensitive: true,
      isWholeWord: true,
      includeGlobs: ["src/**/*.ts", "lib/*"],
      excludeGlobs: ["**/*.test.ts"],
      maxResults: 123,
    });

    const parsed = parseOk(buildContentSearchParams(query));

    expect(parsed).toEqual(query);
  });

  it("round-trips a query with every option off", () => {
    const query = makeQuery({ pattern: "plain", maxResults: 42 });

    expect(parseOk(buildContentSearchParams(query))).toEqual(query);
  });

  it("uses defaults when params are empty", () => {
    const parsed = parseOk(new URLSearchParams());

    expect(parsed).toEqual(
      makeQuery({
        pattern: "",
        maxResults: CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
      }),
    );
  });

  it("treats only the value 1 as true for boolean flags", () => {
    const parsed = parseOk(
      new URLSearchParams({
        pattern: "x",
        regex: "true",
        caseSensitive: "yes",
        wholeWord: "0",
      }),
    );

    expect(parsed.isRegex).toBe(false);
    expect(parsed.isCaseSensitive).toBe(false);
    expect(parsed.isWholeWord).toBe(false);
  });

  it("clamps max 0 up to 1", () => {
    const parsed = parseOk(new URLSearchParams({ pattern: "x", max: "0" }));

    expect(parsed.maxResults).toBe(1);
  });

  it("clamps max 99999 down to the limit", () => {
    const parsed = parseOk(new URLSearchParams({ pattern: "x", max: "99999" }));

    expect(parsed.maxResults).toBe(CONTENT_SEARCH_MAX_RESULTS_LIMIT);
  });

  it("uses the default when max is not a number", () => {
    const parsed = parseOk(new URLSearchParams({ pattern: "x", max: "abc" }));

    expect(parsed.maxResults).toBe(CONTENT_SEARCH_DEFAULT_MAX_RESULTS);
  });

  it("trims globs and drops empty ones", () => {
    const params = new URLSearchParams({ pattern: "x" });
    params.append("include", "  src/**  ");
    params.append("include", "   ");
    params.append("include", "");
    params.append("exclude", " dist/** ");
    params.append("exclude", "");

    const parsed = parseOk(params);

    expect(parsed.includeGlobs).toEqual(["src/**"]);
    expect(parsed.excludeGlobs).toEqual(["dist/**"]);
  });

  it("keeps the pattern untrimmed", () => {
    const pattern = "  spaced  ";

    expect(parseOk(new URLSearchParams({ pattern })).pattern).toBe(pattern);
  });

  it("rejects a pattern containing a newline", () => {
    const message = parseInvalidMessage(
      new URLSearchParams({ pattern: "first\nsecond" }),
    );

    expect(message).toBe("Search text must be a single line");
  });

  it("rejects a pattern containing a carriage return", () => {
    const message = parseInvalidMessage(
      new URLSearchParams({ pattern: "first\rsecond" }),
    );

    expect(message).toBe("Search text must be a single line");
  });

  it("accepts a pattern at the maximum length", () => {
    const pattern = "x".repeat(CONTENT_SEARCH_MAX_PATTERN_LENGTH);

    expect(parseOk(new URLSearchParams({ pattern })).pattern).toBe(pattern);
  });

  it("rejects a pattern longer than the maximum length", () => {
    const pattern = "x".repeat(CONTENT_SEARCH_MAX_PATTERN_LENGTH + 1);

    expect(parseInvalidMessage(new URLSearchParams({ pattern }))).toBe(
      "Search text is too long (max 1000 characters)",
    );
  });

  it("accepts the maximum number of include globs", () => {
    const params = new URLSearchParams({ pattern: "x" });
    for (let index = 0; index < CONTENT_SEARCH_MAX_GLOBS; index++) {
      params.append("include", `dir${index}/**`);
    }

    expect(parseOk(params).includeGlobs).toHaveLength(CONTENT_SEARCH_MAX_GLOBS);
  });

  it("rejects too many include globs", () => {
    const params = new URLSearchParams({ pattern: "x" });
    for (let index = 0; index <= CONTENT_SEARCH_MAX_GLOBS; index++) {
      params.append("include", `dir${index}/**`);
    }

    expect(parseInvalidMessage(params)).toBe("Too many file patterns (max 20)");
  });

  it("rejects too many exclude globs", () => {
    const params = new URLSearchParams({ pattern: "x" });
    for (let index = 0; index <= CONTENT_SEARCH_MAX_GLOBS; index++) {
      params.append("exclude", `dir${index}/**`);
    }

    expect(parseInvalidMessage(params)).toBe("Too many file patterns (max 20)");
  });

  it("rejects an include glob longer than the maximum length", () => {
    const params = new URLSearchParams({ pattern: "x" });
    params.append("include", "a".repeat(CONTENT_SEARCH_MAX_GLOB_LENGTH + 1));

    expect(parseInvalidMessage(params)).toBe(
      "File pattern is too long (max 200 characters)",
    );
  });

  it("rejects an exclude glob longer than the maximum length", () => {
    const params = new URLSearchParams({ pattern: "x" });
    params.append("exclude", "a".repeat(CONTENT_SEARCH_MAX_GLOB_LENGTH + 1));

    expect(parseInvalidMessage(params)).toBe(
      "File pattern is too long (max 200 characters)",
    );
  });

  it("accepts a glob at the maximum length", () => {
    const glob = "a".repeat(CONTENT_SEARCH_MAX_GLOB_LENGTH);
    const params = new URLSearchParams({ pattern: "x" });
    params.append("exclude", glob);

    expect(parseOk(params).excludeGlobs).toEqual([glob]);
  });
});

describe("splitGlobList", () => {
  it("splits on commas, trims and drops empties", () => {
    expect(splitGlobList(" src/** , ,*.ts,  ,lib/*  ,")).toEqual([
      "src/**",
      "*.ts",
      "lib/*",
    ]);
  });

  it("returns an empty list for blank text", () => {
    expect(splitGlobList("")).toEqual([]);
    expect(splitGlobList("  ,  ")).toEqual([]);
  });

  it("returns a single glob unchanged", () => {
    expect(splitGlobList("*.md")).toEqual(["*.md"]);
  });
});
