import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { cloneRepo, extractRepoName, getDefaultCloneBaseDir } from "@/lib/git/clone"

function detectPackageManager(
  dirPath: string
): "pnpm" | "npm" | "bun" | "cargo" | "go" | "none" {
  if (fs.existsSync(path.join(dirPath, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(dirPath, "bun.lockb"))) return "bun"
  if (fs.existsSync(path.join(dirPath, "package-lock.json"))) return "npm"
  if (fs.existsSync(path.join(dirPath, "Cargo.toml"))) return "cargo"
  if (fs.existsSync(path.join(dirPath, "go.mod"))) return "go"
  return "none"
}

// POST: clone a remote repo and register it as a local workspace
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { url, targetDir, name, depth } = body

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  const validUrlPattern = /^(https?:\/\/|git:\/\/|ssh:\/\/|git@)/
  if (!validUrlPattern.test(url)) {
    return NextResponse.json(
      { error: "Invalid git URL. Must start with https://, git://, ssh://, or git@" },
      { status: 400 }
    )
  }

  try {
    const repoName = extractRepoName(url)

    const cloneTarget = targetDir
      ? path.resolve(targetDir)
      : path.join(getDefaultCloneBaseDir(), repoName)

    if (fs.existsSync(cloneTarget)) {
      return NextResponse.json(
        { error: `Directory already exists: ${cloneTarget}` },
        { status: 400 }
      )
    }

    const clonePath = await cloneRepo(url, targetDir, depth)
    const packageManager = detectPackageManager(clonePath)
    const workspaceName = name || repoName

    const workspace = {
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: workspaceName,
      path: clonePath,
      type: "repo" as const,
      parentRepoPath: null,
      packageManager,
      quickCommands: null,
      backend: "local" as const,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    await db.insert(workspaces).values(workspace)

    return NextResponse.json(
      {
        workspace,
        clonePath,
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clone repository"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
