import simpleGit from "simple-git";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Default base directory for cloned repos: ~/dev/
 */
export function getDefaultCloneBaseDir(): string {
  return path.join(os.homedir(), "dev");
}

/**
 * Extract the repo name from a git clone URL.
 *
 * Handles:
 *   https://github.com/user/repo.git  → repo
 *   git@github.com:user/repo.git      → repo
 *   https://github.com/user/repo      → repo
 *   git@github.com:user/repo          → repo
 */
export function extractRepoName(url: string): string {
  // Remove trailing slashes and .git suffix
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  // Get the last path/segment
  const parts = cleaned.split(/[/:]/);
  const name = parts[parts.length - 1];
  if (!name) throw new Error(`Could not extract repo name from URL: ${url}`);
  return name;
}

/**
 * Clone a remote git repository.
 *
 * @param url - The remote URL to clone
 * @param targetDir - Full path to clone into. If omitted, clones into ~/dev/<repo-name>
 * @param depth - Shallow clone depth (omit for full clone)
 * @returns The absolute path to the cloned repo
 */
export async function cloneRepo(
  url: string,
  targetDir?: string,
  depth?: number,
): Promise<string> {
  const repoName = extractRepoName(url);
  const clonePath = targetDir
    ? path.resolve(targetDir)
    : path.join(getDefaultCloneBaseDir(), repoName);

  // Check if target already exists
  if (fs.existsSync(clonePath)) {
    throw new Error(`Directory already exists: ${clonePath}`);
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(clonePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Clone using simple-git from the parent directory
  const git = simpleGit(parentDir);

  const options: string[] = [];
  if (depth && depth > 0) {
    options.push("--depth", String(depth));
  }

  await git.clone(url, clonePath, options);

  return clonePath;
}
