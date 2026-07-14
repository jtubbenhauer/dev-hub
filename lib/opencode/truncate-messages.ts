import type { MessageWithParts, Part } from "@/lib/opencode/types";

// Chat sessions accumulate enormous tool outputs (whole-file reads, bash
// dumps, grep results). A single session can exceed 100MB of JSON, which is
// undownloadable/unparseable on mobile. We cap the big text fields before
// sending to the client and expose a marker so the UI can lazily fetch the
// full part on demand (see loadFullToolOutput in the chat store).
export const MAX_PART_TEXT_CHARS = 2000;

// Stored on ToolPart.metadata so the client knows a field was clipped and can
// offer a "load full output" action. Kept under a namespaced key to avoid
// colliding with tool-provided metadata (e.g. agent sessionId).
export const TRUNCATION_MARKER_KEY = "devhubTruncated";

export interface PartTruncation {
  // Original character length of the clipped field. Presence => it was clipped.
  output?: number;
  error?: number;
  // Keys of ToolState.input whose string values were clipped.
  input?: string[];
}

function clipInput(
  input: Record<string, unknown>,
  max: number,
): { input: Record<string, unknown>; clippedKeys: string[] } {
  const clippedKeys: string[] = [];
  let next: Record<string, unknown> | null = null;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > max) {
      if (!next) next = { ...input };
      next[key] = value.slice(0, max);
      clippedKeys.push(key);
    }
  }

  return { input: next ?? input, clippedKeys };
}

function truncatePart(part: Part, max: number): Part {
  if (part.type !== "tool") return part;

  const marker: PartTruncation = {};
  let state = part.state;

  if (state.status === "completed") {
    let output = state.output;
    if (output.length > max) {
      marker.output = output.length;
      output = output.slice(0, max);
    }
    const { input, clippedKeys } = clipInput(state.input, max);
    if (clippedKeys.length > 0) marker.input = clippedKeys;
    if (marker.output !== undefined || clippedKeys.length > 0) {
      state = { ...state, output, input };
    }
  } else if (state.status === "error") {
    let error = state.error;
    if (error.length > max) {
      marker.error = error.length;
      error = error.slice(0, max);
    }
    const { input, clippedKeys } = clipInput(state.input, max);
    if (clippedKeys.length > 0) marker.input = clippedKeys;
    if (marker.error !== undefined || clippedKeys.length > 0) {
      state = { ...state, error, input };
    }
  } else {
    const { input, clippedKeys } = clipInput(state.input, max);
    if (clippedKeys.length > 0) {
      marker.input = clippedKeys;
      state = { ...state, input };
    }
  }

  const wasClipped =
    marker.output !== undefined ||
    marker.error !== undefined ||
    marker.input !== undefined;
  if (!wasClipped) return part;

  return {
    ...part,
    state,
    metadata: { ...(part.metadata ?? {}), [TRUNCATION_MARKER_KEY]: marker },
  };
}

// Returns a copy of the messages with oversized tool text clipped. Text and
// reasoning parts (the actual conversation) are never touched — only tool
// output/error/input, which is where the megabytes live. Objects that need no
// clipping are returned by identity so unchanged messages stay referentially
// stable.
export function truncateMessagesForTransport(
  messages: MessageWithParts[],
  maxChars: number = MAX_PART_TEXT_CHARS,
): MessageWithParts[] {
  return messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      const truncated = truncatePart(part, maxChars);
      if (truncated !== part) changed = true;
      return truncated;
    });
    return changed ? { ...message, parts } : message;
  });
}

// Client-side reader: returns the truncation marker for a part, or null when
// the part was sent in full.
export function getPartTruncation(part: Part): PartTruncation | null {
  if (part.type !== "tool") return null;
  const metadata = part.metadata as Record<string, unknown> | undefined;
  const marker = metadata?.[TRUNCATION_MARKER_KEY];
  return marker ? (marker as PartTruncation) : null;
}
