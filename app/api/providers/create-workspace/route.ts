import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import type { WorkspaceProvider, WorkspaceProviderCreateResult } from "@/types"
import { DEFAULT_PROVIDER_BEHAVIOUR } from "@/types"

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.binaryPath === "string" &&
    typeof obj.commands === "object" &&
    obj.commands !== null &&
    typeof (obj.commands as Record<string, unknown>).create === "string" &&
    typeof (obj.commands as Record<string, unknown>).destroy === "string" &&
    typeof (obj.commands as Record<string, unknown>).status === "string"
  )
}

function isCreateResult(value: unknown): value is WorkspaceProviderCreateResult {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== "string") return false
  if (!obj.endpoints || typeof obj.endpoints !== "object") return false
  const endpoints = obj.endpoints as Record<string, unknown>
  return typeof endpoints.opencode === "string" && typeof endpoints.agent === "string"
}

function interpolateCommand(
  template: string,
  vars: Record<string, string>
): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

/**
 * Extract a trailing JSON object from mixed CLI output.
 * The create command emits progress text followed by a JSON result block.
 * We find the last balanced `{ ... }` and attempt to parse it.
 */
function extractTrailingJson(output: string): unknown {
  // Strip ANSI escape codes that PTY may inject
  const clean = output.replace(new RegExp("\x1b\\[[0-9;]*[a-zA-Z]", "g"), "").trimEnd()
  const lastBrace = clean.lastIndexOf("}")
  if (lastBrace === -1) return undefined

  let depth = 0
  for (let i = lastBrace; i >= 0; i--) {
    if (clean[i] === "}") depth++
    else if (clean[i] === "{") depth--
    if (depth === 0) {
      try {
        return JSON.parse(clean.slice(i, lastBrace + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

async function verifyAgentHealth(agentUrl: string): Promise<boolean> {
  try {
    const response = await globalThis.fetch(new URL("/health", agentUrl).toString(), {
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return false
    const body = await response.json() as { status?: string }
    return body.status === "ok"
  } catch {
    return false
  }
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const providerId = body.providerId
  if (!providerId || typeof providerId !== "string") {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 })
  }

  const repo = body.repo
  if (!repo || typeof repo !== "string") {
    return NextResponse.json({ error: "repo is required" }, { status: 400 })
  }

  const branch = typeof body.branch === "string" ? body.branch : "main"
  const name = typeof body.name === "string" ? body.name : undefined
  const context = typeof body.context === "string" ? body.context : ""
  const color = typeof body.color === "string" ? body.color : null
  const linkedTaskId = typeof body.linkedTaskId === "string" ? body.linkedTaskId : null
  const linkedTaskMeta = body.linkedTaskMeta && typeof body.linkedTaskMeta === "object"
    ? (body.linkedTaskMeta as Record<string, unknown>)
    : null

  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.userId, session.user.id),
        eq(settings.key, "workspace-providers")
      )
    )

  if (!settingRow) {
    return NextResponse.json({ error: "No providers configured" }, { status: 400 })
  }

  const providerList = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[]).filter(isWorkspaceProvider)
    : []

  const provider = providerList.find((p) => p.id === providerId)
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  }

  const repoName = repo.split("/").pop()?.replace(/\.git$/, "") || "workspace"
  const derivedName = name || repoName
  const isDefaultBranch = !branch || branch === "main" || branch === "master"
  const idSource = name || (!isDefaultBranch ? branch : repoName)

  const id = idSource
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  const templateVars: Record<string, string> = {
    binary: provider.binaryPath,
    repo,
    branch,
    name: derivedName,
    id,
    context,
  }

  const command = interpolateCommand(provider.commands.create, templateVars)
  const userId = session.user.id

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event: string, data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(sseEvent(event, data))) } catch { }
      }

      emit("status", { message: `Running: ${command}` })

      const child = spawn("sh", ["-c", command], { timeout: 300_000 })

      let createStdout = ""

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        createStdout += text
        emit("output", { stream: "stdout", data: text })
      })

      child.stderr.on("data", (chunk: Buffer) => {
        emit("output", { stream: "stderr", data: chunk.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n") })
      })

      request.signal.addEventListener("abort", () => {
        child.kill()
      })

      child.on("error", (err) => {
        emit("error", { message: err.message })
        controller.close()
      })

      child.on("close", (exitCode, signal) => {
        if (exitCode === null) {
          emit("error", { message: `Provider command was terminated by signal ${signal}` })
          controller.close()
          return
        }
        if (exitCode !== 0) {
          emit("error", { message: `Provider command exited with code ${exitCode}` })
          controller.close()
          return
        }

        emit("status", { message: "Command completed. Processing result..." })

        handlePostSpawn({
          provider,
          id,
          repo,
          branch,
          userId,
          color,
          linkedTaskId,
          linkedTaskMeta,
          emit,
          createOutput: createStdout,
        }).then(() => {
          controller.close()
        }).catch((err) => {
          emit("error", { message: err instanceof Error ? err.message : "Post-processing failed" })
          controller.close()
        })
      })
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

interface PostSpawnParams {
  provider: WorkspaceProvider
  id: string
  repo: string
  branch: string
  userId: string
  color: string | null
  linkedTaskId: string | null
  linkedTaskMeta: Record<string, unknown> | null
  emit: (event: string, data: Record<string, unknown>) => void
  createOutput: string
}

async function handlePostSpawn({ provider, id, repo, branch, userId, color, linkedTaskId, linkedTaskMeta, emit, createOutput }: PostSpawnParams) {
  emit("status", { message: "Processing create output..." })

  const parsed = extractTrailingJson(createOutput)
  if (!isCreateResult(parsed)) {
    throw new Error(
      "Provider create command did not output valid JSON. " +
      "Expected a trailing JSON object with { id, endpoints: { opencode, agent }, metadata }."
    )
  }
  const createResult: WorkspaceProviderCreateResult = parsed

  emit("status", { message: "Waiting for agent to become reachable..." })

  const maxAttempts = 15
  const retryDelayMs = 4_000
  let isHealthy = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    isHealthy = await verifyAgentHealth(createResult.endpoints.agent)
    if (isHealthy) break

    if (attempt < maxAttempts) {
      emit("status", { message: `Agent not ready yet, retrying... (${attempt}/${maxAttempts})` })
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }

  if (!isHealthy) {
    throw new Error("Provider created workspace but agent is not reachable after 60s. It may need more time — try connecting manually.")
  }

  emit("status", { message: "Registering workspace..." })

  const workspace = {
    id: crypto.randomUUID(),
    userId,
    name: id,
    path: createResult.metadata.codePath ?? "/workspace",
    type: "repo" as const,
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote" as const,
    provider: provider.name,
    opencodeUrl: createResult.endpoints.opencode,
    agentUrl: createResult.endpoints.agent,
    providerMeta: {
      providerId: provider.id,
      providerWorkspaceId: createResult.id,
      repo,
      branch,
      behaviour: provider.behaviour ?? DEFAULT_PROVIDER_BEHAVIOUR,
      ...createResult.metadata,
    },
    color,
    linkedTaskId,
    linkedTaskMeta,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }

  await db.insert(workspaces).values(workspace)

  emit("result", { workspace })
}

export const maxDuration = 300
