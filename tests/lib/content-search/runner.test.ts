// @vitest-environment node
import * as childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  resolveRipgrepBinary,
  searchWorkspaceContent,
} from "@devhub/shared/content-search";
import type { ContentSearchQuery } from "@devhub/shared";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const query: ContentSearchQuery = {
  pattern: "needle",
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false,
  includeGlobs: [],
  excludeGlobs: [],
  maxResults: 2000,
};
const scratch = "/tmp/omo-scratch/find-in-files/task-6";
const ripgrepBinary = resolveRipgrepBinary();
let root: string;
let gitWorkspacePath: string;
let plainFolderPath: string;

beforeAll(() => {
  fs.mkdirSync(scratch, { recursive: true });
  root = fs.mkdtempSync(path.join(scratch, "tests-"));
  gitWorkspacePath = path.join(root, "repo");
  plainFolderPath = path.join(root, "plain");
  for (const folder of [gitWorkspacePath, plainFolderPath]) {
    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(path.join(folder, "src/a.ts"), "const needle = 1;\n");
  }
  childProcess.execFileSync("git", ["init", "-q"], { cwd: gitWorkspacePath });
  childProcess.execFileSync("git", ["add", "src/a.ts"], {
    cwd: gitWorkspacePath,
  });
});
// Block body: a function returned from a hook is run as its teardown.
beforeEach(() => {
  vi.mocked(childProcess.spawn).mockClear();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("searchWorkspaceContent", () => {
  it("returns an empty ok outcome without spawning when the pattern is empty", async () => {
    const outcome = await searchWorkspaceContent({
      workspacePath: gitWorkspacePath,
      query: { ...query, pattern: "" },
    });

    expect(outcome).toEqual({
      kind: "ok",
      files: [],
      matchCount: 0,
      fileCount: 0,
      isLimitHit: false,
      isTimedOut: false,
      engine: "ripgrep",
      durationMs: 0,
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("uses git grep when ripgrepBinary is null", async () => {
    const outcome = await searchWorkspaceContent({
      workspacePath: gitWorkspacePath,
      query,
      ripgrepBinary: null,
    });

    expect(outcome).toMatchObject({
      kind: "ok",
      engine: "git-grep",
      matchCount: 1,
      files: [{ path: "src/a.ts" }],
    });
    expect(childProcess.spawn).toHaveBeenCalledWith(
      "git",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it.skipIf(ripgrepBinary === null)(
    "uses the resolved ripgrep binary when ripgrepBinary is omitted",
    async () => {
      const outcome = await searchWorkspaceContent({
        workspacePath: gitWorkspacePath,
        query,
      });

      expect(outcome).toMatchObject({
        kind: "ok",
        engine: "ripgrep",
        matchCount: 1,
        files: [{ path: "src/a.ts" }],
      });
      expect(childProcess.spawn).toHaveBeenCalledWith(
        ripgrepBinary,
        expect.any(Array),
        expect.any(Object),
      );
    },
  );

  it.skipIf(ripgrepBinary === null)(
    "uses an explicit ripgrep binary path",
    async () => {
      const outcome = await searchWorkspaceContent({
        workspacePath: plainFolderPath,
        query,
        ripgrepBinary,
      });

      expect(outcome).toMatchObject({ kind: "ok", engine: "ripgrep" });
    },
  );

  it("reports unavailable for a non-git folder when git grep is forced", async () => {
    const outcome = await searchWorkspaceContent({
      workspacePath: plainFolderPath,
      query,
      ripgrepBinary: null,
    });

    expect(outcome.kind).toBe("unavailable");
  });

  it.each([
    ["git grep", null],
    ["the default engine", undefined],
  ])(
    "returns Search cancelled within 50ms without spawning for a pre-aborted signal (%s)",
    async (_engineName, engineBinary) => {
      const controller = new AbortController();
      controller.abort();
      const startedAt = performance.now();

      const outcome = await searchWorkspaceContent({
        workspacePath: gitWorkspacePath,
        query,
        signal: controller.signal,
        ripgrepBinary: engineBinary,
      });

      expect(performance.now() - startedAt).toBeLessThan(50);
      expect(outcome).toEqual({ kind: "failed", message: "Search cancelled" });
      expect(childProcess.spawn).not.toHaveBeenCalled();
    },
  );
});
