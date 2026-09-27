import type {
  AssistantMessage,
  FilePart,
  ReasoningPart,
  Session,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk";

interface OmoUsage {
  readonly input: number;
  readonly output: number;
  readonly cost?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

type OmoUserMessage = UserMessage & {
  metadata?: Record<string, unknown>;
};

type OmoAssistantMessage = AssistantMessage & {
  metadata?: Record<string, unknown>;
};

export function buildOmoUserMessage({
  id,
  sessionID,
  created,
  agent,
  model,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly created: number;
  readonly agent: string;
  readonly model: {
    readonly providerID: string;
    readonly modelID: string;
  };
}): OmoUserMessage {
  const message: OmoUserMessage = {
    id,
    sessionID,
    role: "user",
    time: { created },
    agent,
    model,
  };
  if (agent.startsWith("skill:") && agent.length > "skill:".length) {
    message.metadata = { omoSkill: agent.slice("skill:".length) };
  }
  return message;
}

export function buildOmoAssistantMessage({
  id,
  sessionID,
  parentMessageID,
  created,
  completed,
  modelID,
  providerID,
  cwd,
  usage,
  error,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly parentMessageID: string;
  readonly created: number;
  readonly completed?: number;
  readonly modelID: string;
  readonly providerID: string;
  readonly cwd: string;
  readonly usage: OmoUsage;
  readonly error?: AssistantMessage["error"];
}): OmoAssistantMessage {
  const time: AssistantMessage["time"] = { created };
  if (completed !== undefined) time.completed = completed;

  const message: OmoAssistantMessage = {
    id,
    sessionID,
    role: "assistant",
    time,
    parentID: parentMessageID,
    modelID,
    providerID,
    mode: "omo",
    path: { cwd, root: cwd },
    cost: usage.cost ?? 0,
    tokens: {
      input: usage.input,
      output: usage.output,
      reasoning: 0,
      cache: {
        read: usage.cacheRead ?? 0,
        write: usage.cacheWrite ?? 0,
      },
    },
  };
  if (error !== undefined) message.error = error;
  return message;
}

export function buildOmoTextPart({
  id,
  sessionID,
  messageID,
  text,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly text: string;
}): TextPart {
  return { id, sessionID, messageID, type: "text", text };
}

export function buildOmoReasoningPart({
  id,
  sessionID,
  messageID,
  text,
  start,
  end,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly text: string;
  readonly start: number;
  readonly end?: number;
}): ReasoningPart {
  const time: ReasoningPart["time"] = { start };
  if (end !== undefined) time.end = end;
  return { id, sessionID, messageID, type: "reasoning", text, time };
}

export function buildOmoFilePart({
  id,
  sessionID,
  messageID,
  mime,
  url,
  filename,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly mime: string;
  readonly url: string;
  readonly filename?: string;
}): FilePart {
  const part: FilePart = {
    id,
    sessionID,
    messageID,
    type: "file",
    mime,
    url,
  };
  if (filename !== undefined) part.filename = filename;
  return part;
}

export function buildOmoToolPart({
  id,
  sessionID,
  messageID,
  callID,
  tool,
  state,
}: {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly callID: string;
  readonly tool: string;
  readonly state: ToolState;
}): ToolPart {
  return {
    id,
    sessionID,
    messageID,
    type: "tool",
    callID,
    tool,
    state,
  };
}

export function buildOmoSession({
  rawId,
  workspaceId,
  directory,
  title,
  created,
  updated,
  parentRawId,
}: {
  readonly rawId: string;
  readonly workspaceId: string;
  readonly directory: string;
  readonly title: string;
  readonly created: number;
  readonly updated: number;
  readonly parentRawId?: string;
}): Session {
  const session: Session = {
    id: `omo_${rawId}`,
    projectID: workspaceId,
    directory,
    title,
    version: "omo",
    time: { created, updated },
  };
  if (parentRawId !== undefined) session.parentID = `omo_${parentRawId}`;
  return session;
}
