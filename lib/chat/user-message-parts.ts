import { getInlinedAttachmentFilename } from "@/lib/attachment-utils";
import type { Part } from "@/lib/opencode/types";

export interface InjectedContextBlock {
  id: string;
  text: string;
}

export interface InlinedAttachment {
  id: string;
  filename: string;
}

export interface UserMessageContent {
  text: string;
  attachments: InlinedAttachment[];
  notices: string[];
  injectedBlocks: InjectedContextBlock[];
}

// Plugins tell the developer about themselves inside the text they inject,
// e.g. opencode-supermemory's "[SUPERMEMORY UPDATE]" block.
const UPDATE_NOTICE_HEADER = /^\[[A-Z][A-Z0-9 _-]* UPDATE\]$/;

function extractUpdateNotices(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim().split("\n"))
    .filter(([header]) => UPDATE_NOTICE_HEADER.test(header.trim()))
    .map(([, ...lines]) => lines.join("\n").trim())
    .filter((notice) => notice.length > 0);
}

// Synthetic text parts are added for the model (plugin context, file reads,
// inlined attachments), not typed by the developer, so they stay out of the
// bubble the way OpenCode's TUI leaves them out.
export function splitUserMessageParts(
  parts: readonly Part[],
): UserMessageContent {
  const typedTexts: string[] = [];
  const attachments: InlinedAttachment[] = [];
  const notices: string[] = [];
  const injectedBlocks: InjectedContextBlock[] = [];

  for (const part of parts) {
    if (part.type !== "text" || part.ignored) continue;
    if (!part.synthetic) {
      typedTexts.push(part.text);
      continue;
    }
    const attachmentFilename = getInlinedAttachmentFilename(part.text);
    if (attachmentFilename !== null) {
      attachments.push({ id: part.id, filename: attachmentFilename });
      continue;
    }
    notices.push(...extractUpdateNotices(part.text));
    injectedBlocks.push({ id: part.id, text: part.text });
  }

  return {
    text: typedTexts.join("\n"),
    attachments,
    notices,
    injectedBlocks,
  };
}
