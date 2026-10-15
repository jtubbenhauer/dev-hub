// @vitest-environment node
// allow: SIZE_OK — Task 5 requires one acceptance suite; exhaustive tables share one disposable git fixture.
import fs from "node:fs";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  buildJsMatcher,
  pickGitGrepRanges,
  searchWithGitGrep,
  toGitPathspecs,
  toPosixEre,
} from "@/packages/shared/src/content-search/git-grep";
import * as processRunner from "@/packages/shared/src/content-search/process";
import { sha256Utf8Hex } from "@/packages/shared/src/content-search/line-hash";
import type { ContentSearchQuery } from "@/packages/shared/src/content-search/types";

const query: ContentSearchQuery = {
  pattern: "needle",
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false,
  includeGlobs: [],
  excludeGlobs: [],
  maxResults: 2000,
};
const scratch = "/tmp/omo-scratch/find-in-files/task-5";
let root: string;
let workspacePath: string;
const fixture = {
  "src/a.ts": "needle needle\nNEEDLE\n",
  "src/ünï.ts": "é😀 needle\r\n",
  ".config/settings.json": "needle\n",
  "dir name/a:b.ts": "needle\n",
  "untracked.ts": "needle\n",
  "ignored/x.ts": "needle\n",
  "node_modules/pkg/index.js": "needle\n",
  "nested/node_modules/pkg/index.js": "needle\n",
  "bin.dat": "needle\0binary",
  "big.txt": "padding\n".repeat(140000) + "needle\n",
  "min.js": "x".repeat(1000) + "needle" + "x".repeat(1000),
  "words.txt": "foo foobar -foo x-foo -foobar\n",
  "literal.txt": "a.b axb\n",
  "regex.txt": "WorkspaceBackend 123 /\n",
  "plain.txt": "letter t\n",
  "tabbed.txt": "has\ta tab\n",
  "cap.txt": "cap-match cap-match\n".repeat(100000),
  ".gitignore": "ignored/\n",
} as const;

beforeAll(async () => {
  fs.mkdirSync(scratch, { recursive: true });
  root = fs.mkdtempSync(path.join(scratch, "tests-"));
  workspacePath = path.join(root, "repo");
  fs.mkdirSync(workspacePath);
  for (const [file, text] of Object.entries(fixture)) {
    const target = path.join(workspacePath, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  for (const args of [
    ["init", "-q"],
    ["add", "src/a.ts", ".gitignore"],
  ]) {
    const result = await processRunner.runLineProcess({
      command: "git",
      args,
      cwd: workspacePath,
      timeoutMs: 5000,
      onLine: () => "continue",
    });
    expect(result.exitCode).toBe(0);
  }
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function search(overrides: Partial<ContentSearchQuery> = {}) {
  return searchWithGitGrep({
    workspacePath,
    query: { ...query, ...overrides },
    timeoutMs: 5000,
  });
}

describe("toPosixEre", () => {
  it.each([
    ["(?:foo)", "(foo)"],
    ["\\d", "[0-9]"],
    ["\\D", "[^0-9]"],
    ["\\s", "[[:space:]]"],
    ["\\S", "[^[:space:]]"],
    ["\\w", "[[:alnum:]_]"],
    ["\\W", "[^[:alnum:]_]"],
    ["\\t", "\t"],
    ["[a-z]+", "[a-z]+"],
    ["a{1", "a{1"],
    ["a{1,3}?", null],
    ["a*?", null],
    ["a+?", null],
    ["a??", null],
    ["(?=x)", null],
    ["(?!x)", null],
    ["(?<=x)", null],
    ["(?<!x)", null],
    ["(?<name>x)", null],
    ["(?i:x)", null],
    ["(?", null],
    ["\\", null],
    ["a\\+?", "a\\+?"],
    ["a\\*?", "a\\*?"],
    ["a\\??", "a\\??"],
    ["a\\}?", "a\\}?"],
    ["\\[\\d", "\\[[0-9]"],
    ["[a]\\d", "[a][0-9]"],
    ["é中文", "é中文"],
    ["\\é", null],
    ["\\ ", null],
  ])("translates or rejects %j when scanned", (pattern, source) => {
    // Given / When: the original JS pattern crosses the ERE boundary.
    const result = toPosixEre(pattern);
    // Then: only the allow-listed representation is accepted.
    expect(result).toEqual(
      source === null
        ? { kind: "unsupported", construct: expect.any(String) }
        : { kind: "ok", source },
    );
  });
  it.each(
    Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)),
  )("enforces the escape allow-list for ASCII %j", (character) => {
    const translations: Readonly<Record<string, string>> = {
      d: "[0-9]",
      D: "[^0-9]",
      s: "[[:space:]]",
      S: "[^[:space:]]",
      w: "[[:alnum:]_]",
      W: "[^[:alnum:]_]",
      t: "\t",
    };
    const escaped = `\\${character}`;
    const expected =
      translations[character] ??
      (".[]{}()*+?^$|\\".includes(character) ? escaped : character);
    const isSupported =
      !/[a-z0-9]/i.test(character) || character in translations;
    const result = toPosixEre(escaped);
    expect(result).toEqual(
      isSupported
        ? { kind: "ok", source: expected }
        : { kind: "unsupported", construct: escaped },
    );
  });
  it.each(
    Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)),
  )("rejects every escape inside brackets including %j", (character) => {
    const result = toPosixEre(`[\\${character}]`);
    expect(result.kind).toBe("unsupported");
  });
});

describe("pure git grep helpers", () => {
  it.each([
    [{}, "NEEDLE needle", [0, 7]],
    [{ isCaseSensitive: true }, "NEEDLE needle", [7]],
    [{ pattern: "-foo", isWholeWord: true }, "-foo x-foo -foobar", [0]],
    [{ pattern: "a.b" }, "axb a.b", [4]],
    [{ pattern: ".*+?^${}()|[]\\" }, ".*+?^${}()|[]\\", [0]],
    [{ pattern: "\\d+", isRegex: true }, "x12", [1]],
  ])(
    "builds the original JS matcher when options are %j",
    (overrides, line, indexes) => {
      const matcher = buildJsMatcher({ ...query, ...overrides });
      const matches = [...line.matchAll(matcher)];
      expect(matches.map((match) => match.index)).toEqual(indexes);
    },
  );
  it.each([
    [
      /needle/g,
      8,
      [
        { start: 4, end: 10 },
        { start: 11, end: 17 },
      ],
    ],
    [/else/g, 8, [{ start: 4, end: 4 }]],
    [/missing/g, 8, [{ start: 4, end: 4 }]],
    [/^/g, 8, [{ start: 4, end: 4 }]],
  ])(
    "uses truthful ranges when matcher is %s",
    (matcher, gitColumn, expected) => {
      const line = "é😀 needle needle else";
      const ranges = pickGitGrepRanges({ line, gitColumn, matcher });
      expect(ranges).toEqual(expected);
    },
  );
  it.each([
    [[], [], [".", ":(exclude,glob)**/node_modules/**"]],
    [
      ["./*.ts", "*.ts"],
      ["./src/**"],
      [
        ":(glob)**/*.ts",
        ":(glob)**/*.ts/**",
        ":(exclude,glob)src/**",
        ":(exclude,glob)**/node_modules/**",
      ],
    ],
    [
      ["src", "src/**"],
      ["dist", "node_modules/**"],
      [
        ":(glob)**/src",
        ":(glob)**/src/**",
        ":(glob)src/**",
        ":(exclude,glob)**/dist",
        ":(exclude,glob)**/dist/**",
        ":(exclude,glob)node_modules/**",
        ":(exclude,glob)**/node_modules/**",
      ],
    ],
  ])(
    "builds deduplicated pathspecs for %j excluding %j",
    (includes, excludes, expected) => {
      const result = toGitPathspecs(includes, excludes);
      expect(result).toEqual(expected);
    },
  );
});

describe("searchWithGitGrep using real git", () => {
  it.each([
    [{}, 3],
    [{ isCaseSensitive: true }, 2],
    [{ pattern: "foo", isWholeWord: true, includeGlobs: ["words.txt"] }, 3],
    [{ pattern: "-foo", isWholeWord: true, includeGlobs: ["words.txt"] }, 1],
    [{ pattern: "a.b", includeGlobs: ["literal.txt"] }, 1],
    [{ pattern: "a.b", isRegex: true, includeGlobs: ["literal.txt"] }, 2],
    [
      {
        pattern: "(?:WorkspaceBackend)",
        isRegex: true,
        includeGlobs: ["regex.txt"],
      },
      1,
    ],
    [{ pattern: "\\d+", isRegex: true, includeGlobs: ["regex.txt"] }, 1],
    [{ pattern: "absent" }, 0],
  ])(
    "returns highlighted matches with options %j",
    async (overrides, count) => {
      const result = await search({ includeGlobs: ["src/a.ts"], ...overrides });
      expect(result).toMatchObject({
        kind: "ok",
        matchCount: count,
        engine: "git-grep",
      });
      if (result.kind !== "ok") throw new Error("Expected successful search");
      for (const file of result.files)
        for (const match of file.matches) {
          expect(match.endColumn).toBeGreaterThan(match.startColumn);
        }
    },
  );
  it.each(["(", "(?=x)", "a+?", "\\v", "\\0", "[\\.]"])(
    "rejects %j before spawning within 50ms",
    async (pattern) => {
      const spy = vi.spyOn(processRunner, "runLineProcess");
      const start = performance.now();
      const result = await search({ pattern, isRegex: true });
      expect(performance.now() - start).toBeLessThan(50);
      expect(result.kind).toBe("invalid-pattern");
      expect(spy).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ pattern: "\\t", isRegex: true }, ["tabbed.txt"]],
    [
      { pattern: "\\/", isRegex: true, includeGlobs: ["regex.txt"] },
      ["regex.txt"],
    ],
    [
      { includeGlobs: ["*.ts"], excludeGlobs: ["src/**"] },
      ["dir name/a:b.ts", "untracked.ts"],
    ],
    [
      { includeGlobs: ["*"] },
      [
        ".config/settings.json",
        "big.txt",
        "dir name/a:b.ts",
        "min.js",
        "src/a.ts",
        "src/ünï.ts",
        "untracked.ts",
      ],
    ],
  ])("returns only eligible files with %j", async (overrides, paths) => {
    const result = await search(overrides);
    if (result.kind !== "ok") throw new Error("Expected successful search");
    expect(result.files.map((file) => file.path)).toEqual(paths);
  });
  it("preserves UTF columns and full-line hash when the source is CRLF", async () => {
    const result = await search({ includeGlobs: ["src/ünï.ts"] });
    expect(result).toMatchObject({
      files: [
        {
          matches: [
            {
              lineNumber: 1,
              startColumn: 5,
              endColumn: 11,
              startByteColumn: 8,
              lineSha256: sha256Utf8Hex("é😀 needle"),
              preview: "é😀 needle",
            },
          ],
        },
      ],
    });
  });
  it("maps ERE syntax errors when JS accepts the pattern", async () => {
    const spy = vi.spyOn(processRunner, "runLineProcess");
    const result = await search({ pattern: "a{1", isRegex: true });
    expect(spy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: "invalid-pattern",
      message: expect.stringContaining(
        "The git grep fallback can't run this regex: fatal:",
      ),
    });
  });
  it.each([
    [2, true],
    [3, false],
  ])("caps at %i with limit flag %s", async (maxResults, isLimitHit) => {
    const result = await search({
      pattern: isLimitHit ? "cap-match" : "needle",
      includeGlobs: [isLimitHit ? "cap.txt" : "src/a.ts"],
      maxResults,
    });
    expect(result).toMatchObject({
      kind: "ok",
      matchCount: maxResults,
      isLimitHit,
    });
  });
  it("returns the install message when the folder is not a repository", async () => {
    const result = await searchWithGitGrep({
      workspacePath: root,
      query,
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      kind: "unavailable",
      message:
        "Install ripgrep (rg) to search folders that are not git repositories",
    });
  });
  it("returns cancellation when the caller has aborted", async () => {
    const result = await searchWithGitGrep({
      workspacePath,
      query,
      timeoutMs: 5000,
      signal: AbortSignal.abort(),
    });
    expect(result).toEqual({ kind: "failed", message: "Search cancelled" });
  });
});

describe("git process boundary", () => {
  const completed = {
    exitCode: 0,
    stderr: "",
    spawnErrorCode: null,
    isTimedOut: false,
    isAborted: false,
    isStopped: false,
  } as const;
  it.each([
    [
      { spawnErrorCode: "ENOENT", exitCode: null },
      {
        kind: "unavailable",
        message: "Content search needs ripgrep (rg) or git on the server",
      },
    ],
    [
      { exitCode: 2, stderr: "broken\n" },
      { kind: "failed", message: "broken\n" },
    ],
    [
      { exitCode: 128, stderr: "permission denied" },
      { kind: "failed", message: "permission denied" },
    ],
    [
      { spawnErrorCode: "EACCES", exitCode: null },
      { kind: "failed", message: "" },
    ],
    [
      { exitCode: null, isTimedOut: true },
      { kind: "ok", isTimedOut: true },
    ],
    [
      { exitCode: null, isStopped: true },
      { kind: "ok", isTimedOut: false },
    ],
    [
      { exitCode: null, isAborted: true, isStopped: true },
      { kind: "failed", message: "Search cancelled" },
    ],
    ...[
      "fatal: command line, bad",
      "REGEX failure",
      "regular expression invalid",
      "operand invalid",
      "unmatched bracket",
    ].map(
      (stderr) =>
        [
          { exitCode: 128, stderr },
          {
            kind: "invalid-pattern",
            message: `The git grep fallback can't run this regex: ${stderr}`,
          },
        ] as const,
    ),
  ] as const)("maps process result %j", async (overrides, expected) => {
    vi.spyOn(processRunner, "runLineProcess").mockResolvedValueOnce({
      ...completed,
      ...overrides,
    });
    const result = await search();
    expect(result).toMatchObject(expected);
  });
  it("parses both separators and sorts when output arrives out of order", async () => {
    vi.spyOn(processRunner, "runLineProcess").mockImplementationOnce(
      async ({ onLine }) => {
        for (const output of [
          "malformed",
          "bad\0not numbers",
          "z.ts\0" + "2:1:needle\r\n",
          "a.ts\0" + "3\0" + "1\0needle needle",
          "a.ts\0" + "1:1:needle",
        ])
          onLine(output);
        return completed;
      },
    );
    const result = await search();
    if (result.kind !== "ok") throw new Error("Expected successful search");
    expect(
      result.files.map(({ path, matches }) => [
        path,
        matches.map(({ lineNumber, startColumn }) => [lineNumber, startColumn]),
      ]),
    ).toEqual([
      [
        "a.ts",
        [
          [1, 1],
          [3, 1],
          [3, 8],
        ],
      ],
      ["z.ts", [[2, 1]]],
    ]);
  });
});
