// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import simpleGit, { type SimpleGit } from "simple-git";
import { discardChanges } from "@/lib/git/operations";
import {
  assertWorkspaceRelativePaths,
  partitionDiscardFiles,
  toLiteralPathspecs,
} from "@devhub/shared";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "discard-test-"));
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

describe("discardChanges (local, real git repo)", () => {
  it("case 1: deletes an untracked file from disk", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "untracked.txt", "junk");

    await discardChanges(dir, ["untracked.txt"]);

    expect(exists(dir, "untracked.txt")).toBe(false);
    expect(exists(dir, "tracked.txt")).toBe(true);
  });

  it("case 2: removes wholly-untracked nested directory contents (clean -fd)", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "newdir/nested.txt", "x");

    // simple-git runs status with -u (untracked-files=all), so a wholly-
    // untracked directory is reported as its individual file paths, not a
    // collapsed `newdir/` entry.
    const status = await git.status();
    expect(status.not_added).toContain("newdir/nested.txt");

    await discardChanges(dir, ["newdir/nested.txt"]);

    expect(exists(dir, "newdir/nested.txt")).toBe(false);
    // The untracked change is fully gone from git's perspective (an empty
    // parent dir is invisible to git).
    expect((await git.status()).not_added).not.toContain("newdir/nested.txt");
  });

  it("case 3: restores a tracked modified file to index content", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "original");
    write(dir, "file.txt", "modified");

    await discardChanges(dir, ["file.txt"]);

    expect(read(dir, "file.txt")).toBe("original");
  });

  it("case 4: restores working tree to STAGED version, keeping the staged entry", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "v0");
    write(dir, "file.txt", "v1");
    await git.add("file.txt");
    write(dir, "file.txt", "v2");

    await discardChanges(dir, ["file.txt"]);

    expect(read(dir, "file.txt")).toBe("v1");
    const stagedNames = await git.diff(["--cached", "--name-only"]);
    expect(stagedNames).toContain("file.txt");
  });

  it("case 5: throws on a conflicted path and touches nothing", async () => {
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

    const before = await git.status();
    expect(before.conflicted).toContain("conflict.txt");
    const contentBefore = read(dir, "conflict.txt");

    await expect(discardChanges(dir, ["conflict.txt"])).rejects.toThrow(
      "Cannot discard conflicted file: conflict.txt",
    );

    const after = await git.status();
    expect(after.conflicted).toContain("conflict.txt");
    expect(read(dir, "conflict.txt")).toBe(contentBefore);
  });

  it("case 6: all-untracked input does not invoke checkout (no empty-pathspec crash)", async () => {
    const { git, dir } = await makeRepo();
    // Tracked-modified bystander NOT in the input: if checkout ran with an
    // empty pathspec git would error and this call would reject.
    await commitFile(git, dir, "bystander.txt", "orig");
    write(dir, "bystander.txt", "changed");
    write(dir, "u1.txt", "a");
    write(dir, "u2.txt", "b");

    await expect(
      discardChanges(dir, ["u1.txt", "u2.txt"]),
    ).resolves.toBeUndefined();

    expect(exists(dir, "u1.txt")).toBe(false);
    expect(exists(dir, "u2.txt")).toBe(false);
    expect(read(dir, "bystander.txt")).toBe("changed");
  });

  it("case 7: all-tracked input does not invoke clean (untracked bystander survives)", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "orig");
    write(dir, "file.txt", "changed");
    write(dir, "bystander-untracked.txt", "keep me");

    await discardChanges(dir, ["file.txt"]);

    expect(read(dir, "file.txt")).toBe("orig");
    // If clean had run with an empty pathspec it would delete ALL untracked.
    expect(exists(dir, "bystander-untracked.txt")).toBe(true);
  });

  it("case 8: throws before any git call on ../escape traversal", async () => {
    const { dir } = await makeRepo();
    await expect(discardChanges(dir, ["../escape.txt"])).rejects.toThrow(
      "Invalid path outside workspace",
    );
  });

  it("case 9: throws on absolute POSIX, Windows-drive, UNC, and embedded traversal", async () => {
    const { dir } = await makeRepo();
    for (const bad of [
      "/absolute/path",
      "C:whatever",
      "\\\\unc\\share",
      "a\\..\\b",
    ]) {
      await expect(discardChanges(dir, [bad])).rejects.toThrow(
        "Invalid path outside workspace",
      );
    }
  });

  it("case 10: clean (unchanged tracked) file is a no-op", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "original");

    await expect(discardChanges(dir, ["file.txt"])).resolves.toBeUndefined();

    expect(read(dir, "file.txt")).toBe("original");
  });

  it("case 11: pathspec-magic clean deletes ONLY the literal '*' file", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "*", "star");
    write(dir, "a.txt", "a");
    write(dir, "b.txt", "b");

    await discardChanges(dir, ["*"]);

    expect(exists(dir, "*")).toBe(false);
    expect(exists(dir, "a.txt")).toBe(true);
    expect(exists(dir, "b.txt")).toBe(true);
  });

  it("case 12: pathspec-magic checkout restores ONLY the literal '*' file", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "*", "orig-star");
    await commitFile(git, dir, "sibling.txt", "orig-sibling");
    write(dir, "*", "changed-star");
    write(dir, "sibling.txt", "changed-sibling");

    await discardChanges(dir, ["*"]);

    expect(read(dir, "*")).toBe("orig-star");
    expect(read(dir, "sibling.txt")).toBe("changed-sibling");
  });

  it("case 13: expectedUntracked=[path] but path is tracked -> throws, nothing touched", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "file.txt", "original");
    write(dir, "file.txt", "modified");

    await expect(
      discardChanges(dir, ["file.txt"], ["file.txt"]),
    ).rejects.toThrow("File state changed - refresh and retry");

    expect(read(dir, "file.txt")).toBe("modified");
  });

  it("case 14: expectedUntracked=[] but path is untracked -> throws, nothing touched", async () => {
    const { git, dir } = await makeRepo();
    await commitFile(git, dir, "tracked.txt", "base");
    write(dir, "untracked.txt", "junk");

    await expect(discardChanges(dir, ["untracked.txt"], [])).rejects.toThrow(
      "File state changed - refresh and retry",
    );

    expect(exists(dir, "untracked.txt")).toBe(true);
  });
});

describe("partitionDiscardFiles (pure)", () => {
  it("routes untracked-bucket paths to untracked and tracked paths to tracked", () => {
    const result = partitionDiscardFiles(
      { unstaged: ["mod.txt"], untracked: ["new.txt"], conflicted: [] },
      ["mod.txt", "new.txt"],
    );
    expect(result).toEqual({ tracked: ["mod.txt"], untracked: ["new.txt"] });
  });

  it("all-untracked input yields empty tracked (checkout gate stays closed)", () => {
    const result = partitionDiscardFiles(
      {
        unstaged: ["u1.txt", "u2.txt"],
        untracked: ["u1.txt", "u2.txt"],
        conflicted: [],
      },
      ["u1.txt", "u2.txt"],
    );
    expect(result.tracked).toEqual([]);
    expect(result.untracked).toEqual(["u1.txt", "u2.txt"]);
  });

  it("all-tracked input yields empty untracked (clean gate stays closed)", () => {
    const result = partitionDiscardFiles(
      { unstaged: ["a.txt", "b.txt"], untracked: [], conflicted: [] },
      ["a.txt", "b.txt"],
    );
    expect(result.untracked).toEqual([]);
    expect(result.tracked).toEqual(["a.txt", "b.txt"]);
  });

  it("skips clean files that are in no bucket", () => {
    const result = partitionDiscardFiles(
      { unstaged: [], untracked: [], conflicted: [] },
      ["clean.txt"],
    );
    expect(result).toEqual({ tracked: [], untracked: [] });
  });

  it("throws on a conflicted path", () => {
    expect(() =>
      partitionDiscardFiles(
        { unstaged: [], untracked: [], conflicted: ["c.txt"] },
        ["c.txt"],
      ),
    ).toThrow("Cannot discard conflicted file: c.txt");
  });
});

describe("assertWorkspaceRelativePaths (pure)", () => {
  it("accepts workspace-relative paths including trailing-slash dirs", () => {
    expect(() =>
      assertWorkspaceRelativePaths(["a.txt", "dir/nested.txt", "dir/", "*"]),
    ).not.toThrow();
  });

  it.each([
    "/absolute/path",
    "C:whatever",
    "\\\\unc\\share",
    "a\\..\\b",
    "../escape.txt",
    "a/../b",
  ])("rejects %s", (bad) => {
    expect(() => assertWorkspaceRelativePaths([bad])).toThrow(
      "Invalid path outside workspace",
    );
  });
});

describe("toLiteralPathspecs (pure)", () => {
  it("wraps each path in :(literal)", () => {
    expect(toLiteralPathspecs(["*", "a.txt"])).toEqual([
      ":(literal)*",
      ":(literal)a.txt",
    ]);
  });
});
