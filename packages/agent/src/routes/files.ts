import { Hono } from "hono"
import fs from "node:fs"
import path from "node:path"
import simpleGit from "simple-git"
import type { FileTreeEntry, FileGitStatus } from "@devhub/shared"

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
  "target",
  ".angular",
])

const MAX_FILE_SIZE = 5 * 1024 * 1024

function validatePathWithinWorkspace(
  workspacePath: string,
  requestedPath: string
): string {
  const resolvedWorkspace = path.resolve(workspacePath)
  const resolvedTarget = path.resolve(resolvedWorkspace, requestedPath)

  if (
    !resolvedTarget.startsWith(resolvedWorkspace + path.sep) &&
    resolvedTarget !== resolvedWorkspace
  ) {
    throw new Error("Path traversal denied")
  }

  return resolvedTarget
}

function readDirectoryTree(
  dirPath: string,
  workspacePath: string,
  depth: number = 1
): FileTreeEntry[] {
  const resolvedDir = validatePathWithinWorkspace(
    workspacePath,
    dirPath === workspacePath ? "." : path.relative(workspacePath, dirPath)
  )

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true })
  } catch {
    return []
  }

  const result: FileTreeEntry[] = []

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue

    const fullPath = path.join(resolvedDir, entry.name)
    const relativePath = path.relative(workspacePath, fullPath)

    if (entry.isDirectory()) {
      const treeEntry: FileTreeEntry = {
        name: entry.name,
        path: relativePath,
        type: "directory",
      }

      if (depth > 1) {
        treeEntry.children = readDirectoryTree(fullPath, workspacePath, depth - 1)
      }

      result.push(treeEntry)
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath)
        result.push({
          name: entry.name,
          path: relativePath,
          type: "file",
          size: stat.size,
        })
      } catch {
        result.push({
          name: entry.name,
          path: relativePath,
          type: "file",
        })
      }
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return result
}

async function getFileStatuses(
  workspacePath: string
): Promise<Record<string, FileGitStatus>> {
  const statuses: Record<string, FileGitStatus> = {}

  try {
    const git = simpleGit(workspacePath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return statuses

    const status = await git.status()

    for (const file of status.staged) {
      statuses[file] = "staged"
    }
    for (const file of status.modified) {
      if (!(file in statuses)) {
        statuses[file] = "modified"
      }
    }
    for (const file of status.not_added) {
      statuses[file] = "untracked"
    }
    for (const file of status.deleted) {
      statuses[file] = "deleted"
    }
    for (const renamed of status.renamed) {
      statuses[renamed.to] = "renamed"
    }
    for (const file of status.conflicted) {
      statuses[file] = "conflicted"
    }
    for (const file of status.created) {
      if (!(file in statuses)) {
        statuses[file] = "added"
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return statuses
}

export function fileRoutes(workspacePath: string): Hono {
  const app = new Hono()

  // GET /files/read?path=<relative>
  app.get("/read", (c) => {
    const filePath = c.req.query("path")
    if (!filePath) {
      return c.json({ error: "path query parameter required" }, 400)
    }

    const resolvedPath = validatePathWithinWorkspace(workspacePath, filePath)

    if (!fs.existsSync(resolvedPath)) {
      return c.json({ error: "File not found" }, 404)
    }

    const stat = fs.statSync(resolvedPath)
    if (stat.isDirectory()) {
      return c.json({ error: "Path is a directory" }, 400)
    }

    if (stat.size > MAX_FILE_SIZE) {
      return c.json(
        {
          error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        },
        400
      )
    }

    // Binary check
    const buffer = Buffer.alloc(512)
    const fd = fs.openSync(resolvedPath, "r")
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0)
    fs.closeSync(fd)

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return c.json({ error: "Binary file cannot be displayed" }, 400)
      }
    }

    const content = fs.readFileSync(resolvedPath, "utf-8")
    return c.json({ content, size: stat.size })
  })

  // POST /files/write { path, content }
  app.post("/write", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>()
    if (!body.path || body.content === undefined) {
      return c.json({ error: "path and content required" }, 400)
    }

    const resolvedPath = validatePathWithinWorkspace(workspacePath, body.path)
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(resolvedPath, body.content, "utf-8")
    return c.json({ ok: true })
  })

  // GET /files/tree?path=<dir>&depth=<n>
  app.get("/tree", (c) => {
    const dirPath = c.req.query("path") ?? workspacePath
    const depth = parseInt(c.req.query("depth") ?? "1", 10)
    const entries = readDirectoryTree(dirPath, workspacePath, depth)
    return c.json(entries)
  })

  // GET /files/status
  app.get("/status", async (c) => {
    const statuses = await getFileStatuses(workspacePath)
    return c.json(statuses)
  })

  return app
}
