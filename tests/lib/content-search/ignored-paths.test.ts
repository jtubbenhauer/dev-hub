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
import { findGitIgnoredPaths } from "@/packages/shared/src/content-search/ignored-paths";

let rootDir = "";
let repoDir = "";
let plainDir = "";
let fakeBinDir = "";

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignored-paths-test-"));
  repoDir = path.join(rootDir, "repo");
  plainDir = path.join(rootDir, "plain");
  fakeBinDir = path.join(rootDir, "bin");
  fs.mkdirSync(repoDir);
  fs.mkdirSync(plainDir);
  fs.mkdirSync(fakeBinDir);
  await simpleGit(repoDir).init();
  fs.writeFileSync(
    path.join(repoDir, ".gitignore"),
    "*.generated.ts\nbuild/\n",
  );
  fs.writeFileSync(path.join(fakeBinDir, "git"), "#!/bin/sh\nexec sleep 5\n");
  fs.chmodSync(path.join(fakeBinDir, "git"), 0o755);
});

afterAll(() => {
  if (rootDir !== "") fs.rmSync(rootDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("findGitIgnoredPaths", () => {
  it("returns only the ignored paths, including spaces, colons and non-ASCII", async () => {
    const ignoredPaths = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: [
        "src/a.ts",
        "src/main.generated.ts",
        "docs/sp ace: ñ.generated.ts",
        "docs/sp ace: ñ.ts",
        "build/out.js",
      ],
      timeoutMs: 5_000,
    });

    expect(ignoredPaths).toEqual(
      new Set([
        "src/main.generated.ts",
        "docs/sp ace: ñ.generated.ts",
        "build/out.js",
      ]),
    );
  });

  it("returns an empty set when no path is ignored", async () => {
    const ignoredPaths = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts", "README.md"],
      timeoutMs: 5_000,
    });

    expect(ignoredPaths).toEqual(new Set());
  });

  it("returns null outside a git repository", async () => {
    const ignoredPaths = await findGitIgnoredPaths({
      cwd: plainDir,
      paths: ["a.ts"],
      timeoutMs: 5_000,
    });

    expect(ignoredPaths).toBeNull();
  });

  it("returns null when git cannot be started", async () => {
    vi.stubEnv("PATH", path.join(rootDir, "no-such-dir"));

    const ignoredPaths = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 5_000,
    });

    expect(ignoredPaths).toBeNull();
  });

  it("returns null within the budget when git runs past the timeout", async () => {
    vi.stubEnv("PATH", fakeBinDir);
    const startedAt = Date.now();

    const ignoredPaths = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 200,
    });

    expect(ignoredPaths).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("returns null when the signal aborts", async () => {
    vi.stubEnv("PATH", fakeBinDir);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const ignoredPaths = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(ignoredPaths).toBeNull();
  });
});
