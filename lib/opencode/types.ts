import type {
  Session,
  Message,
  Part,
  Event,
  Provider,
  Model,
  SessionStatus,
  Permission,
  Todo,
  Agent,
} from "@opencode-ai/sdk"

export type { Session, Message, Part, Event, Provider, Model, SessionStatus, Permission, Todo, Agent }

export interface OpenCodeInstance {
  workspaceId: string
  workspacePath: string
  port: number
  url: string
  pid: number | null
  status: "starting" | "ready" | "error" | "stopped"
  lastActivity: number
  errorMessage?: string
}

export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export interface SessionWithMessages {
  session: Session
  messages: MessageWithParts[]
}

export interface ProviderWithModels {
  provider: Provider
  models: Model[]
}

export interface ChatPromptInput {
  sessionId: string
  text: string
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
}

export interface ServerPoolStatus {
  instances: OpenCodeInstance[]
  totalActive: number
}
