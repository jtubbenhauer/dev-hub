import fs from "node:fs";
import path from "node:path";
import type { FileTreeEntry } from "@/types";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".DS_Store",
  "dist",
  ".pnpm-store",
  "target", // Rust/Cargo
  ".angular",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function validatePathWithinWorkspace(
  workspacePath: string,
  requestedPath: string,
): string {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(resolvedWorkspace, requestedPath);

  if (
    !resolvedTarget.startsWith(resolvedWorkspace + path.sep) &&
    resolvedTarget !== resolvedWorkspace
  ) {
    throw new Error("Path traversal denied");
  }

  return resolvedTarget;
}

export function readDirectoryTree(
  dirPath: string,
  workspacePath: string,
  depth: number = 1,
): FileTreeEntry[] {
  const relativePath =
    dirPath === workspacePath
      ? "."
      : path.isAbsolute(dirPath)
        ? path.relative(workspacePath, dirPath)
        : dirPath;
  const resolvedDir = validatePathWithinWorkspace(workspacePath, relativePath);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: FileTreeEntry[] = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith(".")) {
      // Allow dotfiles like .env, .gitignore but skip .git, .next etc
      if (IGNORED_NAMES.has(entry.name)) continue;
    }

    const fullPath = path.join(resolvedDir, entry.name);
    const relativePath = path.relative(workspacePath, fullPath);

    if (entry.isDirectory()) {
      const treeEntry: FileTreeEntry = {
        name: entry.name,
        path: relativePath,
        type: "directory",
      };

      if (depth > 1) {
        treeEntry.children = readDirectoryTree(
          fullPath,
          workspacePath,
          depth - 1,
        );
      }

      result.push(treeEntry);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: relativePath,
          type: "file",
          size: stat.size,
        });
      } catch {
        result.push({
          name: entry.name,
          path: relativePath,
          type: "file",
        });
      }
    }
  }

  // Directories first, then files, both alphabetical
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return result;
}

export function readFileContent(
  workspacePath: string,
  filePath: string,
): { content: string; size: number } {
  const resolvedPath = validatePathWithinWorkspace(workspacePath, filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("File not found");
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error("Path is a directory");
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    );
  }

  // Check if file is binary
  const buffer = Buffer.alloc(512);
  const fd = fs.openSync(resolvedPath, "r");
  const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
  fs.closeSync(fd);

  for (let i = 0; i < bytesRead; i++) {
    if (buffer[i] === 0) {
      throw new Error("Binary file cannot be displayed");
    }
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  return { content, size: stat.size };
}

export function writeFileContent(
  workspacePath: string,
  filePath: string,
  content: string,
): void {
  const resolvedPath = validatePathWithinWorkspace(workspacePath, filePath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolvedPath, content, "utf-8");
}

export function getLanguageFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const languageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".json": "json",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "css",
    ".less": "css",
    ".md": "markdown",
    ".mdx": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "html",
    ".svg": "html",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".fish": "shell",
    ".sql": "sql",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".dockerfile": "dockerfile",
    ".env": "shell",
    ".gitignore": "shell",
  };

  // Check basename for files like Dockerfile, Makefile
  const basename = path.basename(filename).toLowerCase();
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "shell";

  return languageMap[ext] ?? "plaintext";
}
