// Shared types for the command runner WebSocket protocol.
// This file must remain free of server-only imports (node-pty, ws, drizzle, etc.)
// so that client components can safely import from it.

// Messages sent from client → server
export type ClientMessage =
  | { type: "run"; sessionId: string; command: string; workspaceId: string; cols?: number; rows?: number }
  | { type: "kill"; sessionId: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }

// Messages sent from server → client
export type ServerMessage =
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number | null }
  | { type: "error"; sessionId: string; message: string }
  | { type: "started"; sessionId: string; pid: number }

// Autocomplete suggestion shape returned by the API
export interface AutocompleteSuggestion {
  value: string
  label: string
  source: "history" | "alias" | "script" | "make" | "cargo" | "workspace"
  frequency?: number
}
