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
import type {
  ContentSearchOutcome,
  ContentSearchQuery,
} from "@/packages/shared/src/content-search/types";

type OkOutcome = Extract<ContentSearchOutcome, { kind: "ok" }>;

interface FakeRipgrepFile {
  readonly path: string;
  readonly matchCount: number;
  // The exact --glob=!/<this> the engine must pass to exclude the file.
  readonly excludeGlob: string;
}

const GIT_UNAVAILABLE_MESSAGE =
  "Could not check .gitignore for the file filter because git is not available. Remove the file filter to search without it.";

const ROUND_QUERY: ContentSearchQuery = {
  pattern: "roundword",
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false,
  includeGlobs: ["*.ts"],
  excludeGlobs: [],
  maxResults: 3,
};

let rootDir = "";
let repoDir = "";
let plainDir = "";
let binDir = "";
let fakeCount = 0;

function writeRepoFile(relativePath: string, content: string): void {
  const fullPath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function plainFile(filePath: string, matchCount: number): FakeRipgrepFile {
  return { path: filePath, matchCount, excludeGlob: filePath };
}

// A fake rg that logs its args and emits `matchCount` match events per file,
// skipping a file when it receives that file's exclude glob.
function writeFakeRipgrep(files: readonly FakeRipgrepFile[]) {
  fakeCount += 1;
  const binary = path.join(binDir, `fake-rg-${fakeCount}`);
  const argsLog = path.join(binDir, `fake-rg-${fakeCount}.log`);
  const script = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    `const files = ${JSON.stringify(files)};`,
    "const args = process.argv.slice(2);",
    `fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args) + "\\n");`,
    "let output = '';",
    "for (const file of files) {",
    "  if (args.includes('--glob=!/' + file.excludeGlob)) continue;",
    "  for (let line = 1; line <= file.matchCount; line += 1) {",
    "    output += JSON.stringify({ type: 'match', data: { path: { text: './' + file.path }, lines: { text: 'roundword\\n' }, line_number: line, submatches: [{ match: { text: 'roundword' }, start: 0, end: 9 }] } }) + '\\n';",
    "  }",
    "}",
    "process.stdout.write(output);",
  ].join("\n");
  fs.writeFileSync(binary, script);
  fs.chmodSync(binary, 0o755);
  return {
    binary,
    readInvocations(): string[][] {
      return fs
        .readFileSync(argsLog, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line): string[] => JSON.parse(line));
    },
  };
}

// Puts a fake `git` first on PATH; returns the directory it lives in.
function stubGitOnPath(script: string): string {
  fakeCount += 1;
  const gitDir = path.join(binDir, `git-${fakeCount}`);
  fs.mkdirSync(gitDir);
  fs.writeFileSync(path.join(gitDir, "git"), `#!/bin/sh\n${script}\n`);
  fs.chmodSync(path.join(gitDir, "git"), 0o755);
  vi.stubEnv("PATH", `${gitDir}${path.delimiter}${process.env.PATH ?? ""}`);
  return gitDir;
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
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ripgrep-rounds-test-"));
  repoDir = path.join(rootDir, "repo");
  plainDir = path.join(rootDir, "plain");
  binDir = path.join(rootDir, "bin");
  fs.mkdirSync(repoDir);
  fs.mkdirSync(plainDir);
  fs.mkdirSync(binDir);
  await simpleGit(repoDir).init();
  writeRepoFile(
    ".gitignore",
    [
      "*.generated.ts",
      "!meta/a1.generated.ts",
      "!meta/x-y.generated.ts",
      "",
    ].join("\n"),
  );
  writeRepoFile("starve/many.generated.ts", "starveword\n".repeat(7));
  writeRepoFile("starve/eligible.ts", "starveword\n".repeat(4));
  writeRepoFile("meta/a[1].generated.ts", "metaword\nmetaword\n");
  writeRepoFile("meta/x*y.generated.ts", "metaword\nmetaword\n");
  writeRepoFile("meta/sp ace: ñ.generated.ts", "metaword\nmetaword\n");
  writeRepoFile("meta/a1.generated.ts", "metaword\n");
  writeRepoFile("meta/x-y.generated.ts", "metaword\n");
  writeRepoFile("meta/ok.ts", "metaword\n");
  fs.writeFileSync(path.join(plainDir, ".gitignore"), "*.generated.ts\n");
});

afterAll(() => {
  if (rootDir !== "") fs.rmSync(rootDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("searchWithRipgrep ignore rounds (fake rg)", () => {
  function search(binary: string, overrides: Partial<ContentSearchQuery>) {
    return searchWithRipgrep({
      binary,
      workspacePath: repoDir,
      query: { ...ROUND_QUERY, ...overrides },
      timeoutMs: 15_000,
    });
  }

  it("re-runs without an ignored file that used up the cap (starvation)", async () => {
    const fake = writeFakeRipgrep([
      plainFile("r/many.generated.ts", 7),
      plainFile("r/eligible.ts", 4),
    ]);

    const outcome = expectOk(await search(fake.binary, {}));

    expect(filePaths(outcome)).toEqual(["r/eligible.ts"]);
    expect(outcome.matchCount).toBe(3);
    expect(outcome.isLimitHit).toBe(true);
    expect(fake.readInvocations()).toHaveLength(2);
  });

  it("excludes every ignored file found so far, after user globs and before .git", async () => {
    const fake = writeFakeRipgrep([
      plainFile("r/a.generated.ts", 5),
      plainFile("r/b.generated.ts", 5),
      plainFile("r/eligible.ts", 4),
    ]);

    const outcome = expectOk(
      await search(fake.binary, { excludeGlobs: ["dist"] }),
    );
    const invocations = fake.readInvocations();
    const lastArgs = invocations[invocations.length - 1] ?? [];
    const includeIndex = lastArgs.indexOf("--glob=*.ts");

    expect(filePaths(outcome)).toEqual(["r/eligible.ts"]);
    expect(outcome.matchCount).toBe(3);
    expect(invocations).toHaveLength(3);
    expect(lastArgs.slice(includeIndex, includeIndex + 6)).toEqual([
      "--glob=*.ts",
      "--glob=!dist",
      "--glob=!/r/a.generated.ts",
      "--glob=!/r/b.generated.ts",
      "--glob=!.git",
      "--glob=!node_modules",
    ]);
  });

  it("returns only verified files with the limit flag once rounds run out", async () => {
    const fake = writeFakeRipgrep([
      plainFile("r/eligible.ts", 1),
      plainFile("r/i1.generated.ts", 3),
      plainFile("r/i2.generated.ts", 3),
      plainFile("r/i3.generated.ts", 3),
      plainFile("r/i4.generated.ts", 3),
      plainFile("r/i5.generated.ts", 3),
    ]);

    const outcome = expectOk(await search(fake.binary, { maxResults: 2 }));

    expect(filePaths(outcome)).toEqual(["r/eligible.ts"]);
    expect(outcome.matchCount).toBe(1);
    expect(outcome.isLimitHit).toBe(true);
    expect(outcome.isTimedOut).toBe(false);
    expect(fake.readInvocations()).toHaveLength(4);
  });

  it("fails with an explicit message when git is not available", async () => {
    const fake = writeFakeRipgrep([plainFile("r/eligible.ts", 1)]);
    vi.stubEnv("PATH", path.join(rootDir, "no-such-dir"));

    const outcome = await search(fake.binary, {});

    expect(outcome).toEqual({
      kind: "failed",
      message: GIT_UNAVAILABLE_MESSAGE,
    });
  });

  it("keeps include-glob results unfiltered outside a git repository", async () => {
    const fake = writeFakeRipgrep([plainFile("r/many.generated.ts", 2)]);

    const outcome = expectOk(
      await searchWithRipgrep({
        binary: fake.binary,
        workspacePath: plainDir,
        query: ROUND_QUERY,
        timeoutMs: 15_000,
      }),
    );

    expect(filePaths(outcome)).toEqual(["r/many.generated.ts"]);
    expect(outcome.matchCount).toBe(2);
  });

  it("runs a single rg pass and never starts git without include globs", async () => {
    const gitLog = path.join(binDir, "no-include-git.log");
    stubGitOnPath(
      `printf '%s\\n' "$*" >> '${gitLog}'\n/bin/cat > /dev/null\nexit 1`,
    );
    const fake = writeFakeRipgrep([
      plainFile("r/many.generated.ts", 7),
      plainFile("r/eligible.ts", 4),
    ]);

    const outcome = expectOk(await search(fake.binary, { includeGlobs: [] }));

    expect(filePaths(outcome)).toEqual(["r/many.generated.ts"]);
    expect(outcome.matchCount).toBe(3);
    expect(fake.readInvocations()).toHaveLength(1);
    expect(fs.existsSync(gitLog)).toBe(false);
  });

  it("asks git (control for the test above) when include globs are set", async () => {
    const gitLog = path.join(binDir, "include-git.log");
    stubGitOnPath(
      `printf '%s\\n' "$*" >> '${gitLog}'\n/bin/cat > /dev/null\nexit 1`,
    );
    const fake = writeFakeRipgrep([plainFile("r/eligible.ts", 1)]);

    expectOk(await search(fake.binary, {}));

    expect(fs.readFileSync(gitLog, "utf8")).toBe(
      "check-ignore --no-index -z --stdin\n",
    );
  });

  it("returns 'Search cancelled' when aborted during the ignore check", async () => {
    const marker = path.join(binDir, "git-started");
    stubGitOnPath(`: > '${marker}'\nexec /bin/sleep 30`);
    const fake = writeFakeRipgrep([plainFile("r/eligible.ts", 1)]);
    const controller = new AbortController();

    const pending = searchWithRipgrep({
      binary: fake.binary,
      workspacePath: repoDir,
      query: ROUND_QUERY,
      timeoutMs: 15_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), {
      timeout: 10_000,
    });
    controller.abort();

    expect(await pending).toEqual({
      kind: "failed",
      message: "Search cancelled",
    });
  });
});

const ripgrepBinary = resolveRipgrepBinary();

describe.skipIf(ripgrepBinary === null)("ignore rounds (real rg)", () => {
  function search(overrides: Partial<ContentSearchQuery>) {
    return searchWithRipgrep({
      binary: ripgrepBinary ?? "rg",
      workspacePath: repoDir,
      query: { ...ROUND_QUERY, ...overrides },
      timeoutMs: 15_000,
    });
  }

  it("returns maxResults eligible matches when an ignored file has more matches than the cap", async () => {
    const outcome = expectOk(await search({ pattern: "starveword" }));

    expect(filePaths(outcome)).toEqual(["starve/eligible.ts"]);
    expect(outcome.matchCount).toBe(3);
    expect(outcome.isLimitHit).toBe(true);
  });

  // a1 and x-y are eligible look-alikes an unescaped glob would also exclude;
  // an unescaped a[1] would not exclude itself and keep using the cap.
  // isLimitHit depends on rg's file order, so it is not asserted.
  it("excludes ignored files with spaces, colons, non-ASCII and glob metacharacters on re-runs", async () => {
    const outcome = expectOk(await search({ pattern: "metaword" }));

    expect(filePaths(outcome)).toEqual([
      "meta/a1.generated.ts",
      "meta/ok.ts",
      "meta/x-y.generated.ts",
    ]);
    expect(outcome.matchCount).toBe(3);
  });
});
