import type {
  Session,
  Message,
  Part,
  TextPart,
  ToolPart,
  ReasoningPart,
  StepFinishPart,
  Event as SdkEvent,
  Provider,
  Model,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk";

import type {
  Agent,
  Command,
  PermissionRequest,
  QuestionRequest,
  QuestionInfo,
  QuestionOption,
  QuestionAnswer,
} from "@opencode-ai/sdk/v2";

export type {
  Session,
  Message,
  Part,
  TextPart,
  ToolPart,
  ReasoningPart,
  StepFinishPart,
  Provider,
  Model,
  SessionStatus,
  Todo,
  Agent,
};

export interface MessageRekeyedEvent {
  readonly type: "message.rekeyed";
  readonly properties: {
    readonly sessionID: string;
    readonly fromMessageID: string;
    readonly toMessageID: string;
    readonly info: Message;
    readonly parts: Part[];
  };
}

export interface MessagePartDeltaEvent {
  readonly type: "message.part.delta";
  readonly properties: {
    readonly sessionID: string;
    readonly messageID: string;
    readonly partID: string;
    readonly field: string;
    readonly delta: string;
  };
}

export type Event = SdkEvent | MessagePartDeltaEvent | MessageRekeyedEvent;
export type {
  Command,
  PermissionRequest,
  QuestionRequest,
  QuestionInfo,
  QuestionOption,
  QuestionAnswer,
};

export interface OpenCodeInstance {
  workspaceId: string;
  workspacePath: string;
  port: number;
  url: string;
  pid: number | null;
  status: "starting" | "ready" | "error" | "stopped";
  lastActivity: number;
  errorMessage?: string;
}

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

export interface SessionWithMessages {
  session: Session;
  messages: MessageWithParts[];
}

export interface ProviderWithModels {
  provider: Provider;
  models: Model[];
}

export interface ChatPromptInput {
  sessionId: string;
  text: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  agent?: string;
}

export interface ServerPoolStatus {
  instances: OpenCodeInstance[];
  totalActive: number;
}
