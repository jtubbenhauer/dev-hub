import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  isWorktree: boolean;
  hasPackageJson: boolean;
}

function isGitRepo(dirPath: string): boolean {
  const gitPath = path.join(dirPath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isGitWorktree(dirPath: string): boolean {
  const gitPath = path.join(dirPath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    // Worktrees have a .git file (not directory) pointing to the main repo
    return stat.isFile();
  } catch {
    return false;
  }
}

function hasPackageJson(dirPath: string): boolean {
  try {
    return fs.existsSync(path.join(dirPath, "package.json"));
  } catch {
    return false;
  }
}

const HIDDEN_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".pnpm-store",
  "target",
  ".angular",
  ".Trash",
  ".local",
  ".npm",
  ".nvm",
  ".pnpm",
  ".cargo",
  ".rustup",
]);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const browsePath = searchParams.get("path") || os.homedir();

  const resolvedPath = path.resolve(browsePath);

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Directory not found" }, { status: 404 });
  }

  try {
    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });

    const directories: BrowseEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") && HIDDEN_DIRS.has(entry.name)) continue;
      // Skip dotdirs that aren't useful to browse, but keep ones like .config
      if (
        entry.name.startsWith(".") &&
        !["config", "local", "ssh"].includes(entry.name.slice(1))
      )
        continue;

      const fullPath = path.join(resolvedPath, entry.name);

      // Skip directories we can't read
      try {
        fs.accessSync(fullPath, fs.constants.R_OK);
      } catch {
        continue;
      }

      directories.push({
        name: entry.name,
        path: fullPath,
        isGitRepo: isGitRepo(fullPath),
        isWorktree: isGitWorktree(fullPath),
        hasPackageJson: hasPackageJson(fullPath),
      });
    }

    directories.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

    return NextResponse.json({
      currentPath: resolvedPath,
      parentPath: path.dirname(resolvedPath),
      isRoot: resolvedPath === path.dirname(resolvedPath),
      entries: directories,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to read directory" },
      { status: 500 },
    );
  }
}
