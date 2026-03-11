import { Hono } from "hono"
import simpleGit, { type SimpleGit } from "simple-git"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type {
  GitStatusResult,
  GitFileStatus,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  GitDiffResult,
  ReviewChangedFile,
  ReviewFileStatus,
  AllBranch,
  WorktreeInfo,
} from "@devhub/shared"

function createGit(workspacePath: string): SimpleGit {
  return simpleGit(workspacePath)
}

const STATUS_MAP: Record<string, ReviewFileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "modified",
}

function parseStatusLetter(letter: string): ReviewFileStatus {
  const clean = letter.replace(/\d+/g, "")
  return STATUS_MAP[clean] ?? "modified"
}

function readFileContentSafe(workspacePath: string, filePath: string): string {
  try {
    const resolvedWorkspace = path.resolve(workspacePath)
    const resolvedTarget = path.resolve(resolvedWorkspace, filePath)

    if (
      !resolvedTarget.startsWith(resolvedWorkspace + path.sep) &&
      resolvedTarget !== resolvedWorkspace
    ) {
      return ""
    }

    if (!fs.existsSync(resolvedTarget)) return ""
    const stat = fs.statSync(resolvedTarget)
    if (stat.isDirectory() || stat.size > 5 * 1024 * 1024) return ""

    return fs.readFileSync(resolvedTarget, "utf-8")
  } catch {
    return ""
  }
}

function finalizeWorktree(
  partial: Partial<WorktreeInfo>,
  repoPath: string
): WorktreeInfo {
  const resolvedRepo = path.resolve(repoPath)
  const resolvedPath = path.resolve(partial.path ?? "")
  return {
    path: partial.path ?? "",
    branch: partial.branch ?? "",
    head: partial.head ?? "",
    isMain: resolvedPath === resolvedRepo,
    isBare: partial.isBare ?? false,
    isDetached: partial.isDetached ?? false,
  }
}

export function gitRoutes(workspacePath: string): Hono {
  const app = new Hono()

  // --- Core ---

  // GET /git/status
  app.get("/status", async (c) => {
    const git = createGit(workspacePath)

    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      return c.json({
        isRepo: false,
        branch: "",
        tracking: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
        lastCommit: null,
      } satisfies GitStatusResult)
    }

    const status = await git.status()

    const staged: GitFileStatus[] = []
    const unstaged: GitFileStatus[] = []

    for (const file of status.files) {
      if (file.index && file.index !== " " && file.index !== "?") {
        staged.push({
          path: file.path,
          index: file.index,
          workingDir: file.working_dir,
        })
      }
      if (
        file.working_dir &&
        file.working_dir !== " " &&
        file.working_dir !== "?"
      ) {
        unstaged.push({
          path: file.path,
          index: file.index,
          workingDir: file.working_dir,
        })
      }
    }

    let lastCommit: GitStatusResult["lastCommit"] = null
    try {
      const log = await git.log({ maxCount: 1 })
      if (log.latest) {
        lastCommit = {
          hash: log.latest.hash,
          message: log.latest.message,
          author: log.latest.author_name,
          date: log.latest.date,
        }
      }
    } catch {
      // empty repo
    }

    return c.json({
      isRepo: true,
      branch: status.current ?? "",
      tracking: status.tracking ?? null,
      ahead: status.ahead,
      behind: status.behind,
      staged,
      unstaged,
      untracked: status.not_added,
      conflicted: status.conflicted,
      lastCommit,
    } satisfies GitStatusResult)
  })

  // GET /git/log?limit=<n>
  app.get("/log", async (c) => {
    const git = createGit(workspacePath)
    const maxCount = parseInt(c.req.query("limit") ?? "50", 10)

    try {
      const log = await git.log({
        maxCount,
        format: {
          hash: "%H",
          abbrevHash: "%h",
          message: "%s",
          body: "%b",
          author: "%an",
          authorEmail: "%ae",
          date: "%aI",
          refs: "%D",
        },
      })

      const entries: GitLogEntry[] = log.all.map((entry) => ({
        hash: entry.hash,
        abbrevHash: entry.abbrevHash ?? entry.hash.slice(0, 7),
        message: entry.message,
        body: entry.body,
        author: entry.author ?? "",
        authorEmail: entry.authorEmail ?? "",
        date: entry.date,
        refs: entry.refs ?? "",
      }))

      return c.json(entries)
    } catch {
      return c.json([])
    }
  })

  // GET /git/diff?file=<path>&staged=<bool>
  app.get("/diff", async (c) => {
    const git = createGit(workspacePath)
    const file = c.req.query("file")
    const staged = c.req.query("staged") === "true"

    if (!file) {
      return c.json({ error: "file query parameter required" }, 400)
    }

    const args = staged ? ["--cached", "--", file] : ["--", file]
    const diff = await git.diff(args)
    return c.json(diff)
  })

  // GET /git/file-diffs?staged=<bool>
  app.get("/file-diffs", async (c) => {
    const git = createGit(workspacePath)
    const staged = c.req.query("staged") === "true"
    const args = staged ? ["--cached", "--numstat"] : ["--numstat"]
    const numstat = await git.diff(args)

    const results: GitDiffResult[] = []
    for (const line of numstat.trim().split("\n")) {
      if (!line) continue
      const [addStr, delStr, file] = line.split("\t")
      const isBinary = addStr === "-"
      results.push({
        file,
        diff: "",
        additions: isBinary ? 0 : parseInt(addStr, 10),
        deletions: isBinary ? 0 : parseInt(delStr, 10),
        isBinary,
      })
    }

    return c.json(results)
  })

  // GET /git/commit-diff?hash=<sha>
  app.get("/commit-diff", async (c) => {
    const git = createGit(workspacePath)
    const hash = c.req.query("hash")
    if (!hash) {
      return c.json({ error: "hash query parameter required" }, 400)
    }
    const diff = await git.diff([`${hash}~1`, hash])
    return c.json(diff)
  })

  // GET /git/branches
  app.get("/branches", async (c) => {
    const git = createGit(workspacePath)
    const summary = await git.branchLocal()

    const branches: GitBranch[] = Object.entries(summary.branches).map(
      ([name, info]) => ({
        name,
        current: info.current,
        commit: info.commit,
        label: info.label,
        linkedWorkTree: info.linkedWorkTree ?? false,
      })
    )

    return c.json(branches)
  })

  // GET /git/all-branches
  app.get("/all-branches", async (c) => {
    const git = createGit(workspacePath)
    const branches: AllBranch[] = []

    const localResult = await git.branchLocal()
    for (const [name, info] of Object.entries(localResult.branches)) {
      branches.push({ name, isRemote: false, current: info.current })
    }

    try {
      const remoteOutput = await git.raw([
        "branch",
        "-r",
        "--format=%(refname:short)",
      ])
      for (const line of remoteOutput.trim().split("\n")) {
        if (!line || line.includes("HEAD")) continue
        branches.push({ name: line.trim(), isRemote: true, current: false })
      }
    } catch {
      // No remotes
    }

    return c.json(branches)
  })

  // --- Staging ---

  // POST /git/stage { files: string[] }
  app.post("/stage", async (c) => {
    const git = createGit(workspacePath)
    const { files } = await c.req.json<{ files: string[] }>()
    await git.add(files)
    return c.json({ ok: true })
  })

  // POST /git/stage-all
  app.post("/stage-all", async (c) => {
    const git = createGit(workspacePath)
    await git.add(".")
    return c.json({ ok: true })
  })

  // POST /git/unstage { files: string[] }
  app.post("/unstage", async (c) => {
    const git = createGit(workspacePath)
    const { files } = await c.req.json<{ files: string[] }>()
    await git.reset(["HEAD", "--", ...files])
    return c.json({ ok: true })
  })

  // POST /git/unstage-all
  app.post("/unstage-all", async (c) => {
    const git = createGit(workspacePath)
    await git.reset(["HEAD"])
    return c.json({ ok: true })
  })

  // POST /git/discard { files: string[] }
  app.post("/discard", async (c) => {
    const git = createGit(workspacePath)
    const { files } = await c.req.json<{ files: string[] }>()
    await git.checkout(["--", ...files])
    return c.json({ ok: true })
  })

  // --- Commit / Remote ---

  // POST /git/commit { message: string }
  app.post("/commit", async (c) => {
    const git = createGit(workspacePath)
    const { message } = await c.req.json<{ message: string }>()
    const result = await git.commit(message)
    return c.json({ hash: result.commit })
  })

  // POST /git/push { remote?, branch?, setUpstream? }
  app.post("/push", async (c) => {
    const git = createGit(workspacePath)
    const { remote = "origin", branch, setUpstream = false } =
      await c.req.json<{
        remote?: string
        branch?: string
        setUpstream?: boolean
      }>()

    const args: string[] = []
    if (setUpstream) args.push("-u")
    args.push(remote)
    if (branch) args.push(branch)
    await git.push(args)
    return c.json({ result: "ok" })
  })

  // POST /git/pull { remote?, branch? }
  app.post("/pull", async (c) => {
    const git = createGit(workspacePath)
    const { remote = "origin", branch } = await c.req.json<{
      remote?: string
      branch?: string
    }>()
    const pullResult = await git.pull(remote, branch)
    const resultText =
      pullResult.summary.changes > 0
        ? `${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`
        : "Already up to date"
    return c.json({ result: resultText })
  })

  // POST /git/fetch { remote?, prune? }
  app.post("/fetch", async (c) => {
    const git = createGit(workspacePath)
    const { remote = "origin", prune = false } = await c.req.json<{
      remote?: string
      prune?: boolean
    }>()
    const args = prune ? ["--prune", remote] : [remote]
    await git.fetch(args)
    return c.json({ ok: true })
  })

  // --- Branches ---

  // POST /git/branch/create { name, startPoint? }
  app.post("/branch/create", async (c) => {
    const git = createGit(workspacePath)
    const { name, startPoint } = await c.req.json<{
      name: string
      startPoint?: string
    }>()
    if (startPoint) {
      await git.checkoutBranch(name, startPoint)
    } else {
      await git.checkoutLocalBranch(name)
    }
    return c.json({ ok: true })
  })

  // POST /git/branch/switch { name }
  app.post("/branch/switch", async (c) => {
    const git = createGit(workspacePath)
    const { name } = await c.req.json<{ name: string }>()
    await git.checkout(name)
    return c.json({ ok: true })
  })

  // POST /git/branch/delete { name, force? }
  app.post("/branch/delete", async (c) => {
    const git = createGit(workspacePath)
    const { name, force = false } = await c.req.json<{
      name: string
      force?: boolean
    }>()
    await git.deleteLocalBranch(name, force)
    return c.json({ ok: true })
  })

  // --- Stash ---

  // GET /git/stash
  app.get("/stash", async (c) => {
    const git = createGit(workspacePath)
    const result = await git.stashList()

    const stashes: GitStashEntry[] = result.all.map((entry, index) => ({
      index,
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }))

    return c.json(stashes)
  })

  // POST /git/stash/save { message? }
  app.post("/stash/save", async (c) => {
    const git = createGit(workspacePath)
    const { message } = await c.req.json<{ message?: string }>()
    if (message) {
      await git.stash(["push", "-m", message])
    } else {
      await git.stash(["push"])
    }
    return c.json({ ok: true })
  })

  // POST /git/stash/apply { index? }
  app.post("/stash/apply", async (c) => {
    const git = createGit(workspacePath)
    const { index = 0 } = await c.req.json<{ index?: number }>()
    await git.stash(["apply", `stash@{${index}}`])
    return c.json({ ok: true })
  })

  // POST /git/stash/pop { index? }
  app.post("/stash/pop", async (c) => {
    const git = createGit(workspacePath)
    const { index = 0 } = await c.req.json<{ index?: number }>()
    await git.stash(["pop", `stash@{${index}}`])
    return c.json({ ok: true })
  })

  // POST /git/stash/drop { index }
  app.post("/stash/drop", async (c) => {
    const git = createGit(workspacePath)
    const { index } = await c.req.json<{ index: number }>()
    await git.stash(["drop", `stash@{${index}}`])
    return c.json({ ok: true })
  })

  // --- Review helpers ---

  // GET /git/content?path=<file>&ref=<ref|HEAD|staged>
  app.get("/content", async (c) => {
    const git = createGit(workspacePath)
    const filePath = c.req.query("path")
    const ref = c.req.query("ref") ?? "HEAD"

    if (!filePath) {
      return c.json({ error: "path query parameter required" }, 400)
    }

    try {
      const showRef = ref === "staged" ? `:${filePath}` : `${ref}:${filePath}`
      const content = await git.raw(["show", showRef])
      return c.json({ content })
    } catch {
      return c.json({ content: "" })
    }
  })

  // GET /git/changed-files?baseRef=<ref>
  app.get("/changed-files", async (c) => {
    const git = createGit(workspacePath)
    const baseRef = c.req.query("baseRef")
    if (!baseRef) {
      return c.json({ error: "baseRef query parameter required" }, 400)
    }

    const output = await git.raw(["diff", "--name-status", baseRef])
    const files: ReviewChangedFile[] = []
    for (const line of output.trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const status = parseStatusLetter(parts[0])

      if (status === "renamed" || status === "copied") {
        files.push({ path: parts[2], status, oldPath: parts[1] })
      } else {
        files.push({ path: parts[1], status })
      }
    }

    return c.json(files)
  })

  // GET /git/uncommitted-files
  app.get("/uncommitted-files", async (c) => {
    const git = createGit(workspacePath)
    const status = await git.status()
    const files: ReviewChangedFile[] = []
    const seen = new Set<string>()

    for (const file of status.files) {
      if (seen.has(file.path)) continue
      seen.add(file.path)

      const idx = file.index
      const wd = file.working_dir

      if (idx === "?" && wd === "?") {
        files.push({ path: file.path, status: "untracked" })
      } else if (idx === "A" || wd === "A") {
        files.push({ path: file.path, status: "added" })
      } else if (idx === "D" || wd === "D") {
        files.push({ path: file.path, status: "deleted" })
      } else if (idx === "R" || wd === "R") {
        files.push({ path: file.path, status: "renamed" })
      } else {
        files.push({ path: file.path, status: "modified" })
      }
    }

    return c.json(files)
  })

  // GET /git/ref-diff?baseRef=<ref>&path=<file>
  app.get("/ref-diff", async (c) => {
    const git = createGit(workspacePath)
    const baseRef = c.req.query("baseRef")
    const filePath = c.req.query("path")

    if (!baseRef || !filePath) {
      return c.json(
        { error: "baseRef and path query parameters required" },
        400
      )
    }

    try {
      const diff = await git.raw(["diff", baseRef, "--", filePath])
      return c.json(diff)
    } catch {
      return c.json("")
    }
  })

  // GET /git/uncommitted-diff?path=<file>
  app.get("/uncommitted-diff", async (c) => {
    const git = createGit(workspacePath)
    const filePath = c.req.query("path")

    if (!filePath) {
      return c.json({ error: "path query parameter required" }, 400)
    }

    try {
      const diff = await git.raw(["diff", "HEAD", "--", filePath])
      return c.json(diff)
    } catch {
      return c.json("")
    }
  })

  // GET /git/merge-base?ref=<ref>
  app.get("/merge-base", async (c) => {
    const git = createGit(workspacePath)
    const ref = c.req.query("ref")

    if (!ref) {
      return c.json({ error: "ref query parameter required" }, 400)
    }

    const result = await git.raw(["merge-base", "HEAD", ref])
    return c.json({ mergeBase: result.trim() })
  })

  // GET /git/diff-hash?baseRef=<ref>&path=<file>
  app.get("/diff-hash", async (c) => {
    const git = createGit(workspacePath)
    const baseRef = c.req.query("baseRef")
    const filePath = c.req.query("path")

    if (!baseRef || !filePath) {
      return c.json(
        { error: "baseRef and path query parameters required" },
        400
      )
    }

    try {
      const diff = await git.raw(["diff", baseRef, "--", filePath])
      const hash = createHash("md5").update(diff).digest("hex")
      return c.json({ hash })
    } catch {
      const hash = createHash("md5").update("").digest("hex")
      return c.json({ hash })
    }
  })

  // GET /git/uncommitted-diff-hash?path=<file>
  app.get("/uncommitted-diff-hash", async (c) => {
    const git = createGit(workspacePath)
    const filePath = c.req.query("path")

    if (!filePath) {
      return c.json({ error: "path query parameter required" }, 400)
    }

    try {
      const diff = await git.raw(["diff", "HEAD", "--", filePath])
      if (diff) {
        const hash = createHash("md5").update(diff).digest("hex")
        return c.json({ hash })
      }
      // Untracked/new file — hash its content
      const content = readFileContentSafe(workspacePath, filePath)
      const hash = createHash("md5").update(content).digest("hex")
      return c.json({ hash })
    } catch {
      const hash = createHash("md5").update("").digest("hex")
      return c.json({ hash })
    }
  })

  // GET /git/last-commit-ref
  app.get("/last-commit-ref", async (c) => {
    const git = createGit(workspacePath)
    const result = await git.raw(["rev-parse", "HEAD~1"])
    return c.json({ ref: result.trim() })
  })

  // --- Worktrees ---

  // GET /git/worktrees
  app.get("/worktrees", async (c) => {
    const git = createGit(workspacePath)
    const output = await git.raw(["worktree", "list", "--porcelain"])

    const worktrees: WorktreeInfo[] = []
    let current: Partial<WorktreeInfo> = {}

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(finalizeWorktree(current, workspacePath))
        }
        current = { path: line.slice("worktree ".length).trim() }
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length).trim()
      } else if (line.startsWith("branch ")) {
        current.branch = line
          .slice("branch ".length)
          .trim()
          .replace("refs/heads/", "")
      } else if (line === "bare") {
        current.isBare = true
      } else if (line === "detached") {
        current.isDetached = true
      } else if (line === "" && current.path) {
        worktrees.push(finalizeWorktree(current, workspacePath))
        current = {}
      }
    }

    if (current.path) {
      worktrees.push(finalizeWorktree(current, workspacePath))
    }

    return c.json(worktrees)
  })

  // POST /git/worktrees/add { branch, newBranch, basePath?, startPoint? }
  app.post("/worktrees/add", async (c) => {
    const git = createGit(workspacePath)
    const { branch, newBranch, basePath, startPoint } = await c.req.json<{
      branch: string
      newBranch: boolean
      basePath?: string
      startPoint?: string
    }>()

    const baseDir = basePath ?? `${path.resolve(workspacePath)}-worktrees`
    const worktreePath = path.join(baseDir, branch)

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }

    if (fs.existsSync(worktreePath)) {
      return c.json({ error: `Directory already exists: ${worktreePath}` }, 400)
    }

    const args = ["worktree", "add"]
    if (newBranch) {
      args.push("-b", branch)
      args.push(worktreePath)
      if (startPoint) args.push(startPoint)
    } else {
      args.push(worktreePath, branch)
    }

    await git.raw(args)
    return c.json({ path: worktreePath })
  })

  // POST /git/worktrees/remove { path, force? }
  app.post("/worktrees/remove", async (c) => {
    const git = createGit(workspacePath)
    const { path: worktreePath, force = false } = await c.req.json<{
      path: string
      force?: boolean
    }>()

    const args = ["worktree", "remove"]
    if (force) args.push("--force")
    args.push(worktreePath)

    await git.raw(args)
    return c.json({ ok: true })
  })

  return app
}
