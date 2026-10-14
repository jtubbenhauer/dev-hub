import type { PermissionRequest } from "@opencode-ai/sdk/v2";
import type { JsonlRecord } from "@/lib/omo/jsonl";

const TITLE_PREFIX = "Permission required: ";

export type PermissionReply = "once" | "always" | "reject";

export const PERMISSION_ANSWER_LABELS: Readonly<
  Record<PermissionReply, string>
> = {
  once: "Allow once",
  always: "Allow always",
  reject: "Deny",
};

export function isPermissionReply(value: unknown): value is PermissionReply {
  return value === "once" || value === "always" || value === "reject";
}

type PermissionPromptRecord = JsonlRecord & {
  readonly id: string;
  readonly title: string;
  readonly toolCallId: string;
};

export function isPermissionPrompt(
  record: JsonlRecord,
): record is PermissionPromptRecord {
  return (
    record.type === "extension_ui_request" &&
    record.method === "select" &&
    typeof record.id === "string" &&
    typeof record.toolCallId === "string" &&
    typeof record.title === "string" &&
    record.title.startsWith(TITLE_PREFIX)
  );
}

type ParsedPermissionTitle = {
  readonly permission: string;
  readonly patterns: string[];
  readonly details: Record<string, string>;
};

// omo renders the prompt as "Permission required: <permission>", then blank-
// line separated "Label: value" lines and a "Patterns:" list of "  - x" items.
function parsePermissionTitle(title: string): ParsedPermissionTitle {
  const [heading = "", ...lines] = title.split("\n");
  const patterns: string[] = [];
  const details: Record<string, string> = {};
  let isInPatterns = false;
  for (const line of lines) {
    if (line.trim() === "") {
      isInPatterns = false;
      continue;
    }
    if (line.trim() === "Patterns:") {
      isInPatterns = true;
      continue;
    }
    const pattern = /^\s+- (.*)$/.exec(line)?.[1];
    if (isInPatterns && pattern !== undefined) {
      patterns.push(pattern);
      continue;
    }
    const detail = /^([^:]+): (.*)$/.exec(line);
    const label = detail?.[1];
    const value = detail?.[2];
    if (label !== undefined && value !== undefined) details[label] = value;
  }
  return {
    permission: heading.slice(TITLE_PREFIX.length).trim(),
    patterns,
    details,
  };
}

export function mapPermissionPrompt(
  record: PermissionPromptRecord,
  sessionID: string,
  currentAssistantMessageID: string | undefined,
): Omit<PermissionRequest, "id"> {
  const { permission, patterns, details } = parsePermissionTitle(record.title);
  const parentToolCallId = record.parentToolCallId;
  return {
    sessionID,
    permission,
    patterns,
    always: patterns,
    metadata: {
      ...details,
      toolCallId: record.toolCallId,
      ...(typeof parentToolCallId === "string" ? { parentToolCallId } : {}),
    },
    ...(currentAssistantMessageID === undefined
      ? {}
      : {
          tool: {
            messageID: currentAssistantMessageID,
            callID: record.toolCallId,
          },
        }),
  };
}
