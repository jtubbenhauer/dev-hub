import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { exec } from "node:child_process"
import crypto from "node:crypto"
import type { WorkspaceProvider, WorkspaceProviderCreateResult } from "@/types"

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

  // Look up provider from user settings
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

  // Derive a workspace name from the repo URL if not provided
  const derivedName = name || repo.split("/").pop()?.replace(/\.git$/, "") || "Remote Workspace"

  const templateVars: Record<string, string> = {
    binary: provider.binaryPath,
    repo,
    branch,
    name: derivedName,
    context,
  }

  const command = interpolateCommand(provider.commands.create, templateVars)

  // Execute the provider CLI command with a generous timeout for container creation
  let stdout: string
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      exec(command, { timeout: 120_000 }, (error, stdoutBuf, stderrBuf) => {
        if (error) {
          reject(new Error(stderrBuf || error.message))
          return
        }
        resolve(stdoutBuf)
      })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider command failed"
    return NextResponse.json(
      { error: `Provider create command failed: ${message}` },
      { status: 500 }
    )
  }

  // Parse the JSON output from the provider CLI
  let createResult: WorkspaceProviderCreateResult
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    if (!isCreateResult(parsed)) {
      return NextResponse.json(
        { error: "Provider returned invalid JSON. Expected { id, endpoints: { opencode, agent }, metadata }." },
        { status: 500 }
      )
    }
    createResult = parsed
  } catch {
    return NextResponse.json(
      { error: "Provider did not return valid JSON on stdout." },
      { status: 500 }
    )
  }

  // Health-check the new agent (give container time to start)
  const isHealthy = await verifyAgentHealth(createResult.endpoints.agent)
  if (!isHealthy) {
    return NextResponse.json(
      { error: "Provider created workspace but agent is not reachable. It may still be starting up." },
      { status: 502 }
    )
  }

  // Create the workspace record
  const workspace = {
    id: crypto.randomUUID(),
    userId: session.user.id,
    name: derivedName,
    path: "/workspace",
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
      ...createResult.metadata,
    },
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }

  await db.insert(workspaces).values(workspace)

  return NextResponse.json(workspace, { status: 201 })
}
