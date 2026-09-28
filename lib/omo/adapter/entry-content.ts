import type { Part, ToolPart, ToolState } from "@opencode-ai/sdk";
import type { AgentMessageLike } from "@/lib/omo/sessions-on-disk";
import {
  buildOmoFilePart,
  buildOmoReasoningPart,
  buildOmoTextPart,
  buildOmoToolPart,
} from "@/lib/omo/adapter/shapes";
import { messageBoolean } from "@/lib/omo/adapter/entry-message-fields";

export interface BuiltContent {
  readonly parts: Part[];
  readonly toolParts: ToolPart[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function skillFromText(
  text: string,
  skillPrefixes: readonly string[],
): { readonly skill?: string; readonly text: string } {
  const skill = skillPrefixes.find((name) => text.startsWith(`$${name} `));
  if (!skill) return { text };
  return { skill, text: text.slice(skill.length + 2) };
}

function buildContentPart(
  block: unknown,
  index: number,
  options: {
    readonly entryId: string;
    readonly sessionID: string;
    readonly messageID: string;
    readonly created: number;
    readonly textOverride?: string;
  },
): Part | undefined {
  if (!isRecord(block) || typeof block.type !== "string") return undefined;
  const id = `omo_${options.entryId}_${index}`;
  if (block.type === "text" && typeof block.text === "string") {
    return buildOmoTextPart({
      id,
      sessionID: options.sessionID,
      messageID: options.messageID,
      text: options.textOverride ?? block.text,
    });
  }
  if (block.type === "image" && typeof block.mimeType === "string") {
    if (typeof block.data !== "string") return undefined;
    return buildOmoFilePart({
      id,
      sessionID: options.sessionID,
      messageID: options.messageID,
      mime: block.mimeType,
      url: `data:${block.mimeType};base64,${block.data}`,
      filename: typeof block.filename === "string" ? block.filename : undefined,
    });
  }
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return buildOmoReasoningPart({
      id,
      sessionID: options.sessionID,
      messageID: options.messageID,
      text: block.thinking,
      start: finiteNumber(block.startedAt, options.created),
      end:
        typeof block.endedAt === "number" && Number.isFinite(block.endedAt)
          ? block.endedAt
          : undefined,
    });
  }
  if (
    block.type === "toolCall" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  ) {
    const input = isRecord(block.arguments) ? block.arguments : {};
    return buildOmoToolPart({
      id: `omo_${block.id}`,
      sessionID: options.sessionID,
      messageID: options.messageID,
      callID: block.id,
      tool: block.name,
      state: { status: "pending", input, raw: JSON.stringify(input) },
    });
  }
  return undefined;
}

export function buildUserContent(
  message: AgentMessageLike,
  options: {
    readonly entryId: string;
    readonly sessionID: string;
    readonly messageID: string;
    readonly created: number;
    readonly skillPrefixes: readonly string[];
  },
): BuiltContent & { readonly agent: string } {
  const content = message.content;
  if (typeof content === "string") {
    const stripped = skillFromText(content, options.skillPrefixes);
    return {
      agent: stripped.skill ? `skill:${stripped.skill}` : "omo",
      parts: [
        buildOmoTextPart({
          id: `omo_${options.entryId}_0`,
          sessionID: options.sessionID,
          messageID: options.messageID,
          text: stripped.text,
        }),
      ],
      toolParts: [],
    };
  }
  if (!Array.isArray(content))
    return { agent: "omo", parts: [], toolParts: [] };
  const firstBlock = content[0];
  const firstText = isRecord(firstBlock) ? firstBlock.text : undefined;
  const stripped =
    typeof firstText === "string"
      ? skillFromText(firstText, options.skillPrefixes)
      : { text: "" };
  const parts: Part[] = content.flatMap((block: unknown, index: number) => {
    const part = buildContentPart(block, index, {
      ...options,
      textOverride: index === 0 ? stripped.text : undefined,
    });
    return part ? [part] : [];
  });
  return {
    agent: stripped.skill ? `skill:${stripped.skill}` : "omo",
    parts,
    toolParts: [],
  };
}

export function buildAssistantContent(
  message: AgentMessageLike,
  options: {
    readonly entryId: string;
    readonly sessionID: string;
    readonly messageID: string;
    readonly created: number;
  },
): BuiltContent {
  if (!Array.isArray(message.content)) return { parts: [], toolParts: [] };
  const parts = message.content.flatMap((block: unknown, index: number) => {
    const part = buildContentPart(block, index, options);
    return part ? [part] : [];
  });
  return {
    parts,
    toolParts: parts.filter(
      (part: Part): part is ToolPart => part.type === "tool",
    ),
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

export function foldToolResult(
  part: ToolPart,
  targetParts: Part[],
  message: AgentMessageLike,
  options: {
    readonly entryId: string;
    readonly timestamp: number;
    readonly start: number;
  },
): void {
  const details =
    isRecord(message) && isRecord(message.details) ? message.details : {};
  const metadata = { ...details };
  if (part.tool === "task" && typeof details.child_session_id === "string") {
    metadata.sessionId = `omo_${details.child_session_id}`;
  }
  const output = toolResultText(message.content);
  const state: ToolState = messageBoolean(message, "isError")
    ? {
        status: "error",
        input: part.state.input,
        error: output,
        time: { start: options.start, end: options.timestamp },
      }
    : {
        status: "completed",
        input: part.state.input,
        output,
        title: part.tool,
        metadata,
        time: { start: options.start, end: options.timestamp },
      };
  part.state = state;
  if (!Array.isArray(message.content)) return;
  message.content.forEach((block: unknown, index: number) => {
    if (!isRecord(block) || block.type !== "image") return;
    const filePart = buildContentPart(block, index, {
      entryId: options.entryId,
      sessionID: part.sessionID,
      messageID: part.messageID,
      created: options.timestamp,
    });
    if (filePart) targetParts.push(filePart);
  });
}
