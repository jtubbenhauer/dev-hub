"use client"

import { memo, useState, useMemo } from "react"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react"
import AnsiToHtml from "ansi-to-html"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/stores/chat-store"
import { SubAgentDialog } from "@/components/chat/sub-agent-dialog"
import type { ToolPart } from "@/lib/opencode/types"

const MAX_OUTPUT_LINES = 10
const AGENT_TOOL_NAMES = new Set(["agent", "task"])
function containsAnsi(text: string): boolean {
  return text.includes("\u001b[")
}

const ansiConverter = new AnsiToHtml({
  fg: "currentColor",
  bg: "transparent",
  newline: false,
  escapeXML: true,
})

interface MessageToolUseProps {
  part: ToolPart
  nested?: boolean
}

export const MessageToolUse = memo(function MessageToolUse({ part, nested }: MessageToolUseProps) {
  const isAgentTool = AGENT_TOOL_NAMES.has(part.tool)

  if (isAgentTool) {
    return <AgentToolCall part={part} nested={nested} />
  }

  return <StandardToolCall part={part} nested={nested} />
},
(prev, next) => prev.part.id === next.part.id && prev.part.state === next.part.state && prev.nested === next.nested
)

function StandardToolCall({ part, nested }: { part: ToolPart; nested?: boolean }) {
  const { state } = part
  const isActiveStatus = state.status === "running" || state.status === "pending"
  const [userToggled, setUserToggled] = useState(false)
  const [manualExpanded, setManualExpanded] = useState(false)
  const isExpanded = userToggled ? manualExpanded : isActiveStatus

  const statusIcon = getStatusIcon(state.status)
  const statusColor = getStatusColor(state.status)
  const toolDisplayName = getToolDisplayName(part.tool)
  const paramsSummary = formatParamsSummary(part.tool, state.input)
  const duration =
    (state.status === "completed" || state.status === "error") && state.time
      ? formatDuration(state.time.end - state.time.start)
      : null

  const handleToggle = () => {
    if (userToggled) {
      setManualExpanded((prev) => !prev)
    } else {
      setUserToggled(true)
      setManualExpanded(!isActiveStatus)
    }
  }

  return (
    <div className={cn(
      "min-w-0 w-full overflow-hidden py-0.5",
      nested
        ? "pl-1"
        : "border-l-2 border-muted-foreground/30 pl-3 py-1"
    )}>
      {nested && (
        <span className="text-muted-foreground/40 text-xs mr-1 select-none">└</span>
      )}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-left text-xs hover:bg-muted/30 rounded px-1 py-0.5 transition-colors",
          nested ? "inline-flex" : "w-full"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
        )}

        <span className={cn("shrink-0", statusColor)}>{statusIcon}</span>

        <span className="shrink-0 font-medium text-muted-foreground">
          {toolDisplayName}
        </span>

        {isActiveStatus && !paramsSummary && (
          <span className="truncate text-muted-foreground/70 italic">
            {getToolAction(part.tool)}
          </span>
        )}

        {paramsSummary && (
          <span className="truncate text-muted-foreground/70">
            {paramsSummary}
          </span>
        )}

        {duration && (
          <span className="ml-auto shrink-0 text-muted-foreground/50 tabular-nums">
            {duration}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 space-y-1.5 text-xs">
          {state.status === "error" && (
            <p className="truncate text-destructive px-1">
              Error: {typeof state.error === "string" ? state.error.replaceAll("\n", " ") : JSON.stringify(state.error)}
            </p>
          )}

          {state.status === "completed" && state.output && (
            <ToolOutput toolName={part.tool} output={state.output} input={state.input} />
          )}

          {isActiveStatus && state.input && Object.keys(state.input).length > 0 && (
            <ToolParams input={state.input} />
          )}
        </div>
      )}
    </div>
  )
}

function AgentToolCall({ part, nested }: { part: ToolPart; nested?: boolean }) {
  const { state } = part
  const isActiveStatus = state.status === "running" || state.status === "pending"
  const [dialogOpen, setDialogOpen] = useState(false)

  const statusIcon = getStatusIcon(state.status)
  const statusColor = getStatusColor(state.status)
  const duration =
    (state.status === "completed" || state.status === "error") && state.time
      ? formatDuration(state.time.end - state.time.start)
      : null

  const childSessionId = ("metadata" in part.state && (part.state.metadata as Record<string, unknown>)?.sessionId as string | undefined) ?? null
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId)

  const description = typeof state.input?.description === "string"
    ? state.input.description
    : formatParamsSummary(part.tool, state.input)

  return (
    <div className={cn(
      "min-w-0 w-full overflow-hidden",
      nested
        ? "py-0.5 pl-2"
        : "border-l-2 border-violet-500/50 pl-3 py-1.5"
    )}>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-left text-xs hover:bg-muted/30 rounded px-1 py-0.5 transition-colors",
          nested ? "inline-flex" : "w-full"
        )}
      >
        <ExternalLink className="size-3 shrink-0 text-muted-foreground/60" />

        <span className={cn("shrink-0", statusColor)}>{statusIcon}</span>

        <span className="shrink-0 font-medium text-violet-600 dark:text-violet-400">
          Task
        </span>

        <span className="truncate text-muted-foreground/70">
          {description}
        </span>

        {isActiveStatus && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/50" />
        )}

        {duration && (
          <span className="ml-auto shrink-0 text-muted-foreground/50 tabular-nums">
            {duration}
          </span>
        )}

        {state.status === "error" && (
          <span className="ml-auto shrink-0 text-xs text-destructive">
            Error
          </span>
        )}
      </button>

      {childSessionId && activeWorkspaceId && (
        <SubAgentDialog
          childSessionId={childSessionId}
          workspaceId={activeWorkspaceId}
          description={typeof description === "string" ? description : "Sub-agent"}
          isActive={isActiveStatus}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  )
}

function ToolOutput({ toolName, output, input }: { toolName: string; output: string; input: Record<string, unknown> }) {
  const [showAll, setShowAll] = useState(false)
  const lines = output.split("\n")
  const isTruncated = lines.length > MAX_OUTPUT_LINES
  const displayOutput = showAll ? output : lines.slice(0, MAX_OUTPUT_LINES).join("\n")
  const lang = getOutputLanguage(toolName, input)
  const hasAnsi = useMemo(() => containsAnsi(output), [output])
  const ansiHtml = useMemo(
    () => (hasAnsi ? ansiConverter.toHtml(displayOutput) : ""),
    [hasAnsi, displayOutput]
  )

  return (
    <div className="overflow-hidden rounded bg-muted/50">
      <pre className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words p-2 text-xs font-mono",
        lang && !hasAnsi && "text-muted-foreground"
      )}>
        {lang && <code className="text-[10px] uppercase tracking-wider text-muted-foreground/50 block mb-1">{lang}</code>}
        {hasAnsi ? (
          <span dangerouslySetInnerHTML={{ __html: ansiHtml }} />
        ) : (
          displayOutput
        )}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="w-full border-t border-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          {showAll ? "Show less" : `Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}

function ToolParams({ input }: { input: Record<string, unknown> }) {
  return (
    <div className="rounded bg-muted/50 px-2 py-1.5">
      {Object.entries(input).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs leading-relaxed">
          <span className="shrink-0 text-muted-foreground/70">{key}:</span>
          <span className="truncate text-muted-foreground">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

function getToolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    bash: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    glob: "Glob",
    grep: "Grep",
    fetch: "Fetch",
    agent: "Task",
    task: "Task",
    view: "View",
    list: "List",
    search: "Search",
    todowrite: "Todo",
    lsp_diagnostics: "Diagnostics",
    lsp_goto_definition: "Go to Definition",
    lsp_find_references: "Find References",
    lsp_symbols: "Symbols",
    lsp_rename: "Rename",
    lsp_prepare_rename: "Prepare Rename",
    ast_grep_search: "AST Search",
    ast_grep_replace: "AST Replace",
    webfetch: "Web Fetch",
    web_search_exa: "Web Search",
    searchGitHub: "GitHub Search",
    google_search: "Google Search",
    look_at: "Look At",
    interactive_bash: "Terminal",
  }
  return names[tool] ?? tool
}

function getToolAction(tool: string): string {
  const actions: Record<string, string> = {
    bash: "Building command…",
    read: "Reading file…",
    write: "Writing file…",
    edit: "Editing file…",
    glob: "Finding files…",
    grep: "Searching content…",
    fetch: "Fetching URL…",
    agent: "Preparing prompt…",
    task: "Preparing task…",
    view: "Viewing file…",
    list: "Listing…",
    search: "Searching…",
    todowrite: "Updating todos…",
    webfetch: "Fetching page…",
    web_search_exa: "Searching web…",
    searchGitHub: "Searching GitHub…",
    google_search: "Searching Google…",
    look_at: "Analyzing…",
    interactive_bash: "Running terminal…",
    lsp_diagnostics: "Checking diagnostics…",
    lsp_goto_definition: "Finding definition…",
    lsp_find_references: "Finding references…",
    lsp_symbols: "Finding symbols…",
    lsp_rename: "Renaming…",
    ast_grep_search: "Searching AST…",
    ast_grep_replace: "Replacing AST…",
  }
  return actions[tool] ?? "Working…"
}

function getOutputLanguage(tool: string, input: Record<string, unknown>): string | null {
  if (tool === "bash" || tool === "interactive_bash") return "bash"
  if (tool === "read" || tool === "write" || tool === "view") {
    const filePath = (input.filePath ?? input.path ?? input.file ?? "") as string
    return getLangFromPath(filePath)
  }
  return null
}

function getLangFromPath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase()
  if (!ext) return null
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", go: "go", rs: "rust", rb: "ruby",
    java: "java", kt: "kotlin", swift: "swift", c: "c", cpp: "cpp",
    css: "css", scss: "scss", html: "html", json: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
    sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  }
  return langMap[ext] ?? null
}

function formatParamsSummary(tool: string, input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ""

  const primaryKeys: Record<string, string[]> = {
    bash: ["command"],
    read: ["filePath"],
    write: ["filePath"],
    edit: ["filePath"],
    glob: ["pattern"],
    grep: ["pattern", "path"],
    fetch: ["url"],
    webfetch: ["url"],
    view: ["filePath"],
    agent: ["description"],
    task: ["description"],
    search: ["query"],
    web_search_exa: ["query"],
    searchGitHub: ["query"],
    google_search: ["query"],
    lsp_diagnostics: ["filePath"],
    lsp_goto_definition: ["filePath"],
    lsp_find_references: ["filePath"],
    lsp_symbols: ["filePath"],
    lsp_rename: ["filePath", "newName"],
    ast_grep_search: ["pattern"],
    ast_grep_replace: ["pattern", "rewrite"],
    look_at: ["goal"],
  }

  const keys = primaryKeys[tool]
  if (!keys) {
    const entries = Object.entries(input).slice(0, 3)
    return entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(", ")
  }

  const primaryVal = input[keys[0]]
  if (primaryVal == null) return ""

  const primary = formatValue(primaryVal)
  const extras = keys.slice(1)
    .filter((k) => input[k] != null)
    .map((k) => `${k}=${formatValue(input[k])}`)

  const otherKeys = Object.keys(input).filter((k) => !keys.includes(k))
  const otherParams = otherKeys.slice(0, 2).map((k) => `${k}=${formatValue(input[k])}`)
  const allExtras = [...extras, ...otherParams]

  if (allExtras.length > 0) {
    return `${primary} (${allExtras.join(", ")})`
  }
  return primary
}

function formatValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") {
    const singleLine = value.replaceAll("\n", " ")
    return singleLine.length > 80 ? singleLine.slice(0, 77) + "…" : singleLine
  }
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return JSON.stringify(value)
}

function getStatusIcon(status: string) {
  switch (status) {
    case "pending":
      return <Clock className="size-3" />
    case "running":
      return <Loader2 className="size-3 animate-spin" />
    case "completed":
      return <CheckCircle2 className="size-3" />
    case "error":
      return <XCircle className="size-3" />
    default:
      return null
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "text-muted-foreground"
    case "running":
      return "text-blue-500"
    case "completed":
      return "text-green-500"
    case "error":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
