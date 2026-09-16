// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
type GitApp = ReturnType<typeof gitRoutes>;
import simpleGit, { type SimpleGit } from "simple-git";
// Import the route factory directly — NEVER the agent server entrypoint
// (packages/agent/src/index.ts starts a listening server on import).
import { gitRoutes } from "../../packages/agent/src/routes/git";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-discard-test-"));
  createdDirs.push(dir);
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@devhub.local");
  await git.addConfig("user.name", "DevHub Test");
  await git.addConfig("commit.gpgsign", "false");
  return { dir, git };
}

function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), "utf-8");
}

function exists(dir: string, rel: string): boolean {
  return fs.existsSync(path.join(dir, rel));
}

async function commitFile(
  git: SimpleGit,
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  write(dir, rel, content);
  await git.add(rel);
  await git.commit(`add ${rel}`);
}

function mount(dir: string): GitApp {
  // gitRoutes returns a Hono sub-app with routes registered at `/discard`.
  // Request it directly — no parent mount needed, and we never import the
  // agent server entrypoint (packages/agent/src/index.ts).
  return gitRoutes(dir);
}

async function postDiscard(
  app: GitApp,
  body: { files: string[]; expectedUntracked?: string[] },
): Promise<Response> {
  return app.request("/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent /git/discard (Hono integration, real git repo)", () => {
  it("restores a tracked modified file", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "original");
    write(dir, "file.txt", "modified");

    const res = await postDiscard(mount(dir), { files: ["file.txt"] });

    expect(res.status).toBe(200);
    expect(read(dir, "file.txt")).toBe("original");
  });

  it("deletes untracked nested content (clean -fd)", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "newdir/nested.txt", "x");

    // simple-git reports the individual untracked file (status -u), not a
    // collapsed `newdir/` entry.
    const res = await postDiscard(mount(dir), {
      files: ["newdir/nested.txt"],
    });

    expect(res.status).toBe(200);
    expect(exists(dir, "newdir/nested.txt")).toBe(false);
    expect((await git.status()).not_added).not.toContain("newdir/nested.txt");
  });

  it("refuses a conflicted path and touches nothing", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "conflict.txt", "base\n");
    const mainBranch = (await git.branchLocal()).current;
    await git.checkoutLocalBranch("feature");
    write(dir, "conflict.txt", "feature\n");
    await git.add("conflict.txt");
    await git.commit("feature change");
    await git.checkout(mainBranch);
    write(dir, "conflict.txt", "main\n");
    await git.add("conflict.txt");
    await git.commit("main change");
    await git.merge(["feature"]).catch(() => undefined);
    const contentBefore = read(dir, "conflict.txt");

    const res = await postDiscard(mount(dir), { files: ["conflict.txt"] });

    expect(res.ok).toBe(false);
    expect((await git.status()).conflicted).toContain("conflict.txt");
    expect(read(dir, "conflict.txt")).toBe(contentBefore);
  });

  it("rejects a path-guard violation (../escape) and touches nothing", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "original");
    write(dir, "file.txt", "modified");

    const res = await postDiscard(mount(dir), { files: ["../escape.txt"] });

    expect(res.ok).toBe(false);
    expect(read(dir, "file.txt")).toBe("modified");
  });

  it("refuses on expectedUntracked mismatch and touches nothing", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "untracked.txt", "junk");

    const res = await postDiscard(mount(dir), {
      files: ["untracked.txt"],
      expectedUntracked: [],
    });

    expect(res.ok).toBe(false);
    expect(exists(dir, "untracked.txt")).toBe(true);
  });
});
