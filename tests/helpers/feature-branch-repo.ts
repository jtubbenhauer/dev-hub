import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import simpleGit from "simple-git";

function writeFile(dir: string, relativePath: string, content: string): void {
  fs.writeFileSync(path.join(dir, relativePath), content);
}

// A repo on branch "feature" off "main". Committed on feature: feature.txt
// (added, 1 line) and shared.txt (1 line added). Left uncommitted: a second
// line in feature.txt, an edit to untouched.txt and a staged new staged.txt.
// The caller removes the returned directory.
export async function createFeatureBranchRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feature-branch-"));
  const git = simpleGit(dir);
  await git.init(["--initial-branch=main"]);
  await git.addConfig("user.email", "test@devhub.local");
  await git.addConfig("user.name", "DevHub Test");
  await git.addConfig("commit.gpgsign", "false");

  writeFile(dir, "shared.txt", "base\n");
  writeFile(dir, "untouched.txt", "base\n");
  await git.add(["shared.txt", "untouched.txt"]);
  await git.commit("base");

  await git.checkoutLocalBranch("feature");
  writeFile(dir, "shared.txt", "base\ncommitted\n");
  writeFile(dir, "feature.txt", "committed\n");
  await git.add(["shared.txt", "feature.txt"]);
  await git.commit("feature work");

  writeFile(dir, "feature.txt", "committed\nuncommitted\n");
  writeFile(dir, "untouched.txt", "uncommitted\n");
  writeFile(dir, "staged.txt", "staged\n");
  await git.add("staged.txt");
  return dir;
}
