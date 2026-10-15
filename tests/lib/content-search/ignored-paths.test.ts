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
  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig("user.email", "test@devhub.local");
  await git.addConfig("user.name", "DevHub Test");
  await git.addConfig("commit.gpgsign", "false");
  fs.writeFileSync(
    path.join(repoDir, ".gitignore"),
    "*.generated.ts\nbuild/\n",
  );
  fs.mkdirSync(path.join(repoDir, "src"));
  fs.writeFileSync(path.join(repoDir, "src/tracked.generated.ts"), "x\n");
  await git.raw(["add", "-f", ".gitignore", "src/tracked.generated.ts"]);
  await git.commit("tracked file matching .gitignore");
  // Absolute sleep: PATH is stubbed to fakeBinDir only while this runs.
  fs.writeFileSync(
    path.join(fakeBinDir, "git"),
    "#!/bin/sh\nexec /bin/sleep 5\n",
  );
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
    const check = await findGitIgnoredPaths({
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

    expect(check).toEqual({
      kind: "ignored",
      paths: new Set([
        "src/main.generated.ts",
        "docs/sp ace: ñ.generated.ts",
        "build/out.js",
      ]),
    });
  });

  it("reports a tracked file matching .gitignore as ignored, like rg does", async () => {
    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/tracked.generated.ts"],
      timeoutMs: 5_000,
    });

    expect(check).toEqual({
      kind: "ignored",
      paths: new Set(["src/tracked.generated.ts"]),
    });
  });

  it("returns an empty ignored set when no path is ignored", async () => {
    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts", "README.md"],
      timeoutMs: 5_000,
    });

    expect(check).toEqual({ kind: "ignored", paths: new Set() });
  });

  it("returns not-a-repository outside a git repository", async () => {
    const check = await findGitIgnoredPaths({
      cwd: plainDir,
      paths: ["a.ts"],
      timeoutMs: 5_000,
    });

    expect(check).toEqual({ kind: "not-a-repository" });
  });

  it("returns unavailable when git cannot be started", async () => {
    vi.stubEnv("PATH", path.join(rootDir, "no-such-dir"));

    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 5_000,
    });

    expect(check).toEqual({ kind: "unavailable" });
  });

  it("returns timed-out without starting git when the budget is already spent", async () => {
    vi.stubEnv("PATH", path.join(rootDir, "no-such-dir"));

    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 0,
    });

    expect(check).toEqual({ kind: "timed-out" });
  });

  it("returns timed-out when git runs past the timeout", async () => {
    vi.stubEnv("PATH", fakeBinDir);

    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 200,
    });

    expect(check).toEqual({ kind: "timed-out" });
  });

  it("returns aborted when the signal aborts", async () => {
    vi.stubEnv("PATH", fakeBinDir);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const check = await findGitIgnoredPaths({
      cwd: repoDir,
      paths: ["src/a.ts"],
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(check).toEqual({ kind: "aborted" });
  });
});
