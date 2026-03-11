// Shared types for the command runner.
// This file must remain free of server-only imports so that client components can safely import from it.

export interface AutocompleteSuggestion {
  value: string
  label: string
  source: "history" | "alias" | "script" | "make" | "cargo" | "workspace"
  frequency?: number
}

// SSE event types streamed from POST /api/commands/run
export interface CommandDataEvent {
  type: "data"
  data: string
}

export interface CommandExitEvent {
  type: "exit"
  exitCode: number | null
}

export interface CommandErrorEvent {
  type: "error"
  message: string
}

export type CommandSSEEvent = CommandDataEvent | CommandExitEvent | CommandErrorEvent

// Shape of a running process exposed by GET /api/commands/active
export interface ActiveProcess {
  sessionId: string
  command: string
  workspaceId: string
  pid: number | undefined
  startedAt: number
  exited: boolean
  exitCode: number | null
}

// Request body for POST /api/commands/run
export interface RunCommandRequest {
  command: string
  workspaceId: string
}

// Request body for POST /api/commands/kill
export interface KillCommandRequest {
  sessionId: string
  workspaceId?: string
}
