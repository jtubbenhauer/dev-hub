import type {
  Message,
  MessageWithParts,
  Part,
  ToolPart,
} from "@/lib/opencode/types";

// Port of the OpenCode TUI's /export formatter (packages/tui/src/util/transcript.ts)
// so a transcript exported from dev-hub reads exactly like one from the TUI.

export interface TranscriptSession {
  readonly id: string;
  readonly title: string;
  readonly time: { readonly created: number; readonly updated: number };
}

export interface TranscriptProvider {
  readonly id: string;
  readonly models: Readonly<Record<string, { readonly name: string }>>;
}

export interface TranscriptOptions {
  readonly thinking: boolean;
  readonly toolDetails: boolean;
  readonly assistantMetadata: boolean;
  readonly providers: readonly TranscriptProvider[];
}

type AssistantMessage = Extract<Message, { role: "assistant" }>;

function titlecase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function getModelName(
  providers: readonly TranscriptProvider[],
  providerID: string,
  modelID: string,
): string {
  const provider = providers.find((candidate) => candidate.id === providerID);
  return provider?.models[modelID]?.name ?? modelID;
}

// OpenCode sends `agent`; the v1 SDK type only declares the older `mode`.
function getAgentName(message: AssistantMessage): string {
  return "agent" in message && typeof message.agent === "string"
    ? message.agent
    : message.mode;
}

function formatAssistantHeader(
  message: AssistantMessage,
  options: TranscriptOptions,
): string {
  if (!options.assistantMetadata) return "## Assistant\n\n";

  const { created, completed } = message.time;
  const duration =
    completed && created ? `${((completed - created) / 1000).toFixed(1)}s` : "";
  const modelName = getModelName(
    options.providers,
    message.providerID,
    message.modelID,
  );
  const durationSuffix = duration ? ` · ${duration}` : "";

  return `## Assistant (${titlecase(getAgentName(message))} · ${modelName}${durationSuffix})\n\n`;
}

function formatToolPart(part: ToolPart, options: TranscriptOptions): string {
  const { state } = part;
  let result = `**Tool: ${part.tool}**\n`;
  if (options.toolDetails && state.input) {
    result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(state.input, null, 2)}\n\`\`\`\n`;
  }
  if (options.toolDetails && state.status === "completed" && state.output) {
    result += `\n**Output:**\n\`\`\`\n${state.output}\n\`\`\`\n`;
  }
  if (options.toolDetails && state.status === "error" && state.error) {
    result += `\n**Error:**\n\`\`\`\n${state.error}\n\`\`\`\n`;
  }
  return `${result}\n`;
}

function formatPart(part: Part, options: TranscriptOptions): string {
  switch (part.type) {
    case "text":
      return part.synthetic ? "" : `${part.text}\n\n`;
    case "reasoning":
      return options.thinking ? `_Thinking:_\n\n${part.text}\n\n` : "";
    case "tool":
      return formatToolPart(part, options);
    default:
      // Like the TUI, steps, patches, files and the rest stay out of transcripts.
      return "";
  }
}

function formatMessage(
  { info, parts }: MessageWithParts,
  options: TranscriptOptions,
): string {
  const header =
    info.role === "user" ? "## User\n\n" : formatAssistantHeader(info, options);
  return header + parts.map((part) => formatPart(part, options)).join("");
}

export function formatTranscript(
  session: TranscriptSession,
  messages: readonly MessageWithParts[],
  options: TranscriptOptions,
): string {
  const header =
    `# ${session.title}\n\n` +
    `**Session ID:** ${session.id}\n` +
    `**Created:** ${new Date(session.time.created).toLocaleString()}\n` +
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n` +
    "---\n\n";
  const chronological = [...messages].sort(
    (a, b) =>
      a.info.time.created - b.info.time.created ||
      a.info.id.localeCompare(b.info.id),
  );
  return (
    header +
    chronological
      .map((message) => `${formatMessage(message, options)}---\n\n`)
      .join("")
  );
}
