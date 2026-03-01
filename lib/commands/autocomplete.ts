import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { db } from "@/lib/db"
import { commandHistory } from "@/drizzle/schema"
import { eq, desc, sql } from "drizzle-orm"
import type { AutocompleteSuggestion } from "./types"

export type { AutocompleteSuggestion }

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch {
    return null
  }
}

async function parseShellAliases(): Promise<AutocompleteSuggestion[]> {
  const rcPaths = [
    path.join(os.homedir(), ".zshrc"),
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".bash_aliases"),
  ]

  const suggestions: AutocompleteSuggestion[] = []
  const aliasPattern = /^alias\s+([^=]+)=['"](.+)['"]\s*$/

  for (const rcPath of rcPaths) {
    const content = await readFileOrNull(rcPath)
    if (!content) continue

    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      const match = trimmed.match(aliasPattern)
      if (match) {
        const [, name, command] = match
        suggestions.push({
          value: name.trim(),
          label: `${name.trim()} → ${command}`,
          source: "alias",
        })
      }
    }
  }

  return suggestions
}

async function parsePackageScripts(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const pkgPath = path.join(workspacePath, "package.json")
  const content = await readFileOrNull(pkgPath)
  if (!content) return []

  try {
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> }
    if (!pkg.scripts) return []

    return Object.entries(pkg.scripts).map(([name, command]) => ({
      value: `npm run ${name}`,
      label: `npm run ${name} → ${command}`,
      source: "script" as const,
    }))
  } catch {
    return []
  }
}

async function parseMakeTargets(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const makefilePath = path.join(workspacePath, "Makefile")
  const content = await readFileOrNull(makefilePath)
  if (!content) return []

  const suggestions: AutocompleteSuggestion[] = []
  // Match targets that start at column 0 followed by a colon (exclude variables)
  const targetPattern = /^([a-zA-Z0-9_-]+)\s*:/gm
  let match: RegExpExecArray | null

  while ((match = targetPattern.exec(content)) !== null) {
    const target = match[1]
    if (target && !target.startsWith(".")) {
      suggestions.push({
        value: `make ${target}`,
        label: `make ${target}`,
        source: "make",
      })
    }
  }

  return suggestions
}

async function parseCargoTargets(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const cargoPath = path.join(workspacePath, "Cargo.toml")
  const content = await readFileOrNull(cargoPath)
  if (!content) return []

  const baseCommands: AutocompleteSuggestion[] = [
    { value: "cargo build", label: "cargo build", source: "cargo" },
    { value: "cargo test", label: "cargo test", source: "cargo" },
    { value: "cargo run", label: "cargo run", source: "cargo" },
    { value: "cargo check", label: "cargo check", source: "cargo" },
    { value: "cargo clippy", label: "cargo clippy", source: "cargo" },
    { value: "cargo fmt", label: "cargo fmt", source: "cargo" },
  ]

  return baseCommands
}

async function getHistoryFrequency(
  workspaceId: string
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      command: commandHistory.command,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(commandHistory)
    .where(eq(commandHistory.workspaceId, workspaceId))
    .groupBy(commandHistory.command)
    .orderBy(desc(sql`count(*)`))
    .limit(200)

  const freqMap = new Map<string, number>()
  for (const row of rows) {
    freqMap.set(row.command, row.count)
  }
  return freqMap
}

async function getRecentHistory(workspaceId: string): Promise<AutocompleteSuggestion[]> {
  const rows = await db
    .select({
      command: commandHistory.command,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(commandHistory)
    .where(eq(commandHistory.workspaceId, workspaceId))
    .groupBy(commandHistory.command)
    .orderBy(desc(sql`count(*)`))
    .limit(50)

  return rows.map((row) => ({
    value: row.command,
    label: row.command,
    source: "history" as const,
    frequency: row.count,
  }))
}

export async function getSuggestions(
  workspaceId: string,
  workspacePath: string,
  query: string
): Promise<AutocompleteSuggestion[]> {
  const [history, aliases, scripts, makeTargets, cargoTargets, freqMap] =
    await Promise.all([
      getRecentHistory(workspaceId),
      parseShellAliases(),
      parsePackageScripts(workspacePath),
      parseMakeTargets(workspacePath),
      parseCargoTargets(workspacePath),
      getHistoryFrequency(workspaceId),
    ])

  const all: AutocompleteSuggestion[] = [
    ...history,
    ...aliases,
    ...scripts,
    ...makeTargets,
    ...cargoTargets,
  ]

  // Deduplicate by value, preferring history entries
  const seen = new Map<string, AutocompleteSuggestion>()
  for (const s of all) {
    if (!seen.has(s.value)) {
      seen.set(s.value, { ...s, frequency: freqMap.get(s.value) ?? s.frequency })
    }
  }

  const filtered = Array.from(seen.values()).filter((s) =>
    s.value.toLowerCase().includes(query.toLowerCase())
  )

  // Sort: history first by frequency, then by source priority
  const sourcePriority: Record<AutocompleteSuggestion["source"], number> = {
    history: 0,
    script: 1,
    make: 2,
    cargo: 3,
    alias: 4,
    workspace: 5,
  }

  filtered.sort((a, b) => {
    const freqDiff = (b.frequency ?? 0) - (a.frequency ?? 0)
    if (freqDiff !== 0) return freqDiff
    return sourcePriority[a.source] - sourcePriority[b.source]
  })

  return filtered.slice(0, 20)
}

export async function recordCommand(
  workspaceId: string,
  command: string,
  exitCode: number | null
): Promise<void> {
  await db.insert(commandHistory).values({
    workspaceId,
    command,
    exitCode,
  })
}
