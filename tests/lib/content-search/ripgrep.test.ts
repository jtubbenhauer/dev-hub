// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import simpleGit from "simple-git";
import {
  resolveRipgrepBinary,
  searchWithRipgrep,
} from "@/packages/shared/src/content-search/ripgrep";
import { sha256Utf8Hex } from "@/packages/shared/src/content-search/line-hash";
import type {
  ContentSearchOutcome,
  ContentSearchQuery,
} from "@/packages/shared/src/content-search/types";

type OkOutcome = Extract<ContentSearchOutcome, { kind: "ok" }>;

const DEFAULT_QUERY: ContentSearchQuery = {
  pattern: "needle",
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false,
  includeGlobs: [],
  excludeGlobs: [],
  maxResults: 2000,
};

const MINIFIED_LINE = "a".repeat(1000) + "needle" + "b".repeat(994);

let rootDir = "";
let repoDir = "";
let fakeBinDir = "";

function writeFixture(relativePath: string, content: string | Buffer): void {
  const fullPath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function writeFakeBinary(name: string, script: string): string {
  const fullPath = path.join(fakeBinDir, name);
  fs.writeFileSync(fullPath, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(fullPath, 0o755);
  return fullPath;
}

function expectOk(outcome: ContentSearchOutcome): OkOutcome {
  if (outcome.kind !== "ok") {
    throw new Error(`expected ok outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

function filePaths(outcome: OkOutcome): string[] {
  return outcome.files.map((file) => file.path);
}

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ripgrep-engine-test-"));
  repoDir = path.join(rootDir, "repo");
  fakeBinDir = path.join(rootDir, "bin");
  fs.mkdirSync(repoDir);
  fs.mkdirSync(fakeBinDir);
  await simpleGit(repoDir).init();

  writeFixture(
    "src/a.ts",
    "const needle = needle + 1;\nconst other = 2;\n// Needle again\n",
  );
  writeFixture("src/ünï.ts", "// ünï 🎉 needle\n");
  writeFixture("src/words.ts", "const needles = 0;\n");
  writeFixture("src/crlf.ts", "first needle\r\nsecond needle\r\n");
  writeFixture("root.ts", "export const needle = true;\n");
  writeFixture(".config/settings.json", '{ "needle": true }\n');
  writeFixture(".gitignore", "ignored/\n");
  writeFixture("ignored/x.ts", "needle\n");
  writeFixture("node_modules/pkg/index.js", "needle\n");
  writeFixture(".git/needle-note.txt", "needle\n");
  writeFixture("bin.dat", Buffer.from("needle\u0000needle\n", "utf8"));
  writeFixture("big.txt", "needle\n" + "x".repeat(1_100_000) + "\n");
  writeFixture("min.js", MINIFIED_LINE + "\n");
});

afterAll(() => {
  if (rootDir !== "") fs.rmSync(rootDir, { recursive: true, force: true });
});

const ripgrepBinary = resolveRipgrepBinary();

describe.skipIf(ripgrepBinary === null)("searchWithRipgrep (real rg)", () => {
  function search(overrides: Partial<ContentSearchQuery>) {
    return searchWithRipgrep({
      binary: ripgrepBinary ?? "rg",
      workspacePath: repoDir,
      query: { ...DEFAULT_QUERY, ...overrides },
      timeoutMs: 15_000,
    });
  }

  it("finds case-insensitive matches by default, including dotfiles, sorted by path", async () => {
    const outcome = expectOk(await search({}));

    expect(filePaths(outcome)).toEqual([
      ".config/settings.json",
      "min.js",
      "root.ts",
      "src/a.ts",
      "src/crlf.ts",
      "src/ünï.ts",
      "src/words.ts",
    ]);
    expect(outcome.engine).toBe("ripgrep");
    expect(outcome.isLimitHit).toBe(false);
    expect(outcome.isTimedOut).toBe(false);
    expect(outcome.fileCount).toBe(7);
    expect(outcome.matchCount).toBe(10);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("excludes gitignored, node_modules, .git, binary and >1MB files", async () => {
    const paths = filePaths(expectOk(await search({})));

    expect(paths).not.toContain("ignored/x.ts");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths).not.toContain(".git/needle-note.txt");
    expect(paths).not.toContain("bin.dat");
    expect(paths).not.toContain("big.txt");
  });

  it("reports UTF-16 columns sorted by line and column", async () => {
    const outcome = expectOk(await search({}));
    const fileA = outcome.files.find((file) => file.path === "src/a.ts");

    expect(
      fileA?.matches.map((match) => [
        match.lineNumber,
        match.startColumn,
        match.endColumn,
      ]),
    ).toEqual([
      [1, 7, 13],
      [1, 16, 22],
      [3, 4, 10],
    ]);
  });

  it("converts byte offsets after non-ASCII text to UTF-16 and byte columns", async () => {
    const outcome = expectOk(await search({}));
    const unicodeFile = outcome.files.find(
      (file) => file.path === "src/ünï.ts",
    );

    expect(unicodeFile?.matches).toHaveLength(1);
    expect(unicodeFile?.matches[0]).toMatchObject({
      lineNumber: 1,
      startColumn: 11,
      endColumn: 17,
      startByteColumn: 15,
    });
  });

  it("hashes each match's full source line with its line ending stripped", async () => {
    const outcome = expectOk(await search({}));

    for (const file of outcome.files) {
      const sourceLines = fs
        .readFileSync(path.join(repoDir, file.path), "utf8")
        .split(/\r?\n/);
      for (const match of file.matches) {
        const sourceLine = sourceLines[match.lineNumber - 1] ?? "";
        expect(match.lineSha256).toBe(sha256Utf8Hex(sourceLine));
      }
    }
  });

  it("windows a minified line preview with an ellipsis around the match", async () => {
    const outcome = expectOk(await search({}));
    const minified = outcome.files.find((file) => file.path === "min.js");
    const match = minified?.matches[0];

    expect(match?.startColumn).toBe(1001);
    expect(match?.preview.startsWith("…")).toBe(true);
    expect(match?.preview.endsWith("…")).toBe(true);
    expect(
      match?.preview.slice(match.previewMatchStart, match.previewMatchEnd),
    ).toBe("needle");
  });

  it("matches only the exact case when case-sensitive", async () => {
    const outcome = expectOk(
      await search({ pattern: "Needle", isCaseSensitive: true }),
    );

    expect(filePaths(outcome)).toEqual(["src/a.ts"]);
    expect(outcome.files[0]?.matches.map((match) => match.lineNumber)).toEqual([
      3,
    ]);
  });

  it("skips partial-word matches when whole word is on", async () => {
    const paths = filePaths(expectOk(await search({ isWholeWord: true })));

    expect(paths).toContain("src/a.ts");
    expect(paths).not.toContain("src/words.ts");
    expect(paths).not.toContain("min.js");
  });

  it("treats the pattern as a regex only when regex is on", async () => {
    const regexOutcome = expectOk(
      await search({ pattern: "NE+DLE\\s*=", isRegex: true }),
    );
    const literalOutcome = expectOk(await search({ pattern: "NE+DLE\\s*=" }));

    expect(filePaths(regexOutcome)).toEqual(["root.ts", "src/a.ts"]);
    expect(literalOutcome.matchCount).toBe(0);
  });

  it("returns invalid-pattern with rg's message for an invalid regex", async () => {
    const outcome = await search({ pattern: "(", isRegex: true });

    expect(outcome.kind).toBe("invalid-pattern");
    if (outcome.kind !== "invalid-pattern") return;
    expect(outcome.message).toContain("regex parse error");
    expect(outcome.message.length).toBeLessThanOrEqual(500);
  });

  it("searches an unbalanced paren literally when regex is off", async () => {
    const outcome = expectOk(await search({ pattern: "(" }));

    expect(outcome.matchCount).toBe(0);
  });

  it("applies include then exclude globs", async () => {
    const outcome = expectOk(
      await search({ includeGlobs: ["*.ts"], excludeGlobs: ["src/**"] }),
    );

    expect(filePaths(outcome)).toEqual(["root.ts"]);
  });

  it("still excludes .git and node_modules when the include glob is *", async () => {
    const paths = filePaths(expectOk(await search({ includeGlobs: ["*"] })));

    expect(paths).toContain("root.ts");
    expect(paths.some((filePath) => filePath.startsWith(".git/"))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith("node_modules/"))).toBe(
      false,
    );
  });

  it("stops at maxResults and reports the limit", async () => {
    const outcome = expectOk(await search({ maxResults: 2 }));
    const collected = outcome.files.reduce(
      (total, file) => total + file.matches.length,
      0,
    );

    expect(outcome.isLimitHit).toBe(true);
    expect(outcome.matchCount).toBe(2);
    expect(collected).toBe(2);
    expect(outcome.fileCount).toBe(outcome.files.length);
  });
});

describe("searchWithRipgrep (fake binaries)", () => {
  function searchWith(binary: string, overrides: Partial<ContentSearchQuery>) {
    return searchWithRipgrep({
      binary,
      workspacePath: repoDir,
      query: { ...DEFAULT_QUERY, ...overrides },
      timeoutMs: 5_000,
    });
  }

  it("passes the arguments in the documented order", async () => {
    const argsFile = path.join(rootDir, "args.txt");
    const binary = writeFakeBinary(
      "args-rg",
      `printf '%s\\n' "$@" > '${argsFile}'`,
    );

    await searchWith(binary, {
      pattern: "-e foo",
      includeGlobs: ["*.ts", "lib/**"],
      excludeGlobs: ["dist"],
    });

    expect(fs.readFileSync(argsFile, "utf8").split("\n").slice(0, -1)).toEqual([
      "--json",
      "--no-config",
      "--no-messages",
      "--hidden",
      "--max-filesize=1M",
      "--ignore-case",
      "--fixed-strings",
      "--glob=*.ts",
      "--glob=lib/**",
      "--glob=!dist",
      "--glob=!.git",
      "--glob=!node_modules",
      "--regexp=-e foo",
      "--",
      ".",
    ]);
  });

  it("omits ignore-case and fixed-strings and adds word-regexp per toggles", async () => {
    const argsFile = path.join(rootDir, "toggle-args.txt");
    const binary = writeFakeBinary(
      "toggle-rg",
      `printf '%s\\n' "$@" > '${argsFile}'`,
    );

    await searchWith(binary, {
      isCaseSensitive: true,
      isWholeWord: true,
      isRegex: true,
    });

    expect(fs.readFileSync(argsFile, "utf8").split("\n").slice(5, 7)).toEqual([
      "--word-regexp",
      "--glob=!.git",
    ]);
  });

  it("returns ok with isTimedOut when rg runs past the timeout", async () => {
    const binary = writeFakeBinary("fake-rg", "exec sleep 5");
    const startedAt = Date.now();

    const outcome = await searchWithRipgrep({
      binary,
      workspacePath: repoDir,
      query: DEFAULT_QUERY,
      timeoutMs: 200,
    });

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(outcome).toMatchObject({
      kind: "ok",
      isTimedOut: true,
      isLimitHit: false,
      matchCount: 0,
      engine: "ripgrep",
    });
  });

  it("returns failed 'Search cancelled' when the signal aborts", async () => {
    const binary = writeFakeBinary("abort-rg", "exec sleep 5");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const outcome = await searchWithRipgrep({
      binary,
      workspacePath: repoDir,
      query: DEFAULT_QUERY,
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ kind: "failed", message: "Search cancelled" });
  });

  it("returns unavailable when the binary cannot be started", async () => {
    const outcome = await searchWith(path.join(fakeBinDir, "missing-rg"), {});

    expect(outcome).toEqual({
      kind: "unavailable",
      message: "ripgrep could not be started",
    });
  });

  it("returns failed with stderr on exit 2 without matches", async () => {
    const binary = writeFakeBinary(
      "broken-rg",
      "echo 'boom happened' >&2\nexit 2",
    );

    const outcome = await searchWith(binary, {});

    expect(outcome).toEqual({ kind: "failed", message: "boom happened" });
  });

  it("keeps collected matches on exit 2 and skips unparseable or non-UTF-8 events", async () => {
    const matchEvent = JSON.stringify({
      type: "match",
      data: {
        path: { text: "./x/y.ts" },
        lines: { text: "a needle\n" },
        line_number: 4,
        submatches: [{ match: { text: "needle" }, start: 2, end: 8 }],
      },
    });
    const bytesEvent = JSON.stringify({
      type: "match",
      data: {
        path: { bytes: "eC55LnRz" },
        lines: { text: "needle\n" },
        line_number: 1,
        submatches: [{ match: { text: "needle" }, start: 0, end: 6 }],
      },
    });
    const binary = writeFakeBinary(
      "partial-rg",
      [
        "echo 'not json'",
        `printf '%s\\n' '${bytesEvent}'`,
        `printf '%s\\n' '${matchEvent}'`,
        "echo 'some file failed' >&2",
        "exit 2",
      ].join("\n"),
    );

    const outcome = expectOk(await searchWith(binary, {}));

    expect(filePaths(outcome)).toEqual(["x/y.ts"]);
    expect(outcome.files[0]?.matches[0]).toMatchObject({
      lineNumber: 4,
      startColumn: 3,
      endColumn: 9,
    });
  });

  it("clamps a submatch end past the line ending to the line length", async () => {
    const matchEvent = JSON.stringify({
      type: "match",
      data: {
        path: { text: "z.ts" },
        lines: { text: "needle\r\n" },
        line_number: 1,
        submatches: [{ match: { text: "needle\r\n" }, start: 0, end: 8 }],
      },
    });
    const binary = writeFakeBinary(
      "clamp-rg",
      `printf '%s\\n' '${matchEvent}'`,
    );

    const outcome = expectOk(await searchWith(binary, {}));

    expect(outcome.files[0]?.matches[0]).toMatchObject({
      startColumn: 1,
      endColumn: 7,
    });
  });
});

describe("resolveRipgrepBinary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the first executable rg file found on PATH", () => {
    const notExecutableDir = path.join(rootDir, "path-not-executable");
    const directoryDir = path.join(rootDir, "path-directory");
    const executableDir = path.join(rootDir, "path-executable");
    fs.mkdirSync(notExecutableDir);
    fs.mkdirSync(path.join(directoryDir, "rg"), { recursive: true });
    fs.mkdirSync(executableDir);
    fs.writeFileSync(path.join(notExecutableDir, "rg"), "#!/bin/sh\n");
    fs.chmodSync(path.join(notExecutableDir, "rg"), 0o644);
    fs.writeFileSync(path.join(executableDir, "rg"), "#!/bin/sh\n");
    fs.chmodSync(path.join(executableDir, "rg"), 0o755);
    vi.stubEnv(
      "PATH",
      [notExecutableDir, directoryDir, executableDir].join(path.delimiter),
    );

    expect(resolveRipgrepBinary()).toBe(path.join(executableDir, "rg"));
  });

  it("falls back to the well-known install locations when PATH has no rg", () => {
    vi.stubEnv("PATH", path.join(rootDir, "empty-path-dir"));

    const resolved = resolveRipgrepBinary();

    expect([
      "/opt/homebrew/bin/rg",
      "/usr/local/bin/rg",
      "/usr/bin/rg",
      null,
    ]).toContain(resolved);
  });
});
