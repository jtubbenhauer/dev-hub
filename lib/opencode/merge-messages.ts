import type { MessageWithParts, Part } from "@/lib/opencode/types";
import { getPartTruncation } from "@/lib/opencode/truncate-messages";

// Windowed/cached message responses must be MERGED into the in-memory array,
// never used to replace it — replacing drops older loaded history and live SSE
// messages. Message IDs are treated as opaque identity keys; ordering always
// comes from server array order plus existing array segments, never from
// sorting IDs.

function mergeParts(existing: Part[], incoming: Part[]): Part[] {
  const existingById = new Map(existing.map((part) => [part.id, part]));
  return incoming.map((incomingPart) => {
    const existingPart = existingById.get(incomingPart.id);
    if (!existingPart) return incomingPart;
    // Keep the existing part when incoming is a truncated copy of one we
    // already hold in full — this protects user-expanded tool output (and
    // richer live state) from being collapsed by a truncated window/cache.
    if (getPartTruncation(incomingPart) && !getPartTruncation(existingPart)) {
      return existingPart;
    }
    return incomingPart;
  });
}

function mergeMessage(
  existing: MessageWithParts,
  incoming: MessageWithParts,
): MessageWithParts {
  return {
    info: incoming.info,
    parts: mergeParts(existing.parts, incoming.parts),
  };
}

// Merge an initial/tail window (the newest `limit` messages) into existing.
// The overlap between the two ordered lists anchors the splice; disjoint
// existing messages are older history and stay in front.
export function mergeTailWindow(
  existing: MessageWithParts[],
  incoming: MessageWithParts[],
): MessageWithParts[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const incomingById = new Map(incoming.map((m) => [m.info.id, m]));

  const overlapIndexes: number[] = [];
  existing.forEach((m, index) => {
    if (incomingById.has(m.info.id)) overlapIndexes.push(index);
  });

  // A tail window is always the newest slice, so if it shares nothing with
  // existing, existing must be older history — keep it before the window.
  if (overlapIndexes.length === 0) {
    return [...existing, ...incoming];
  }

  const firstOverlap = overlapIndexes[0];
  const lastOverlap = overlapIndexes[overlapIndexes.length - 1];
  const existingById = new Map(existing.map((m) => [m.info.id, m]));

  const prefix = existing
    .slice(0, firstOverlap)
    .filter((m) => !incomingById.has(m.info.id));
  const suffix = existing
    .slice(lastOverlap + 1)
    .filter((m) => !incomingById.has(m.info.id));

  const merged = incoming.map((incomingMessage) => {
    const existingMessage = existingById.get(incomingMessage.info.id);
    return existingMessage
      ? mergeMessage(existingMessage, incomingMessage)
      : incomingMessage;
  });

  return [...prefix, ...merged, ...suffix];
}

// Merge an older window (from loadOlderMessages) onto the head. Returns the
// number of genuinely new messages so the caller can adjust Virtuoso's
// firstItemIndex and keep the scroll position stable.
export function mergePrependWindow(
  existing: MessageWithParts[],
  older: MessageWithParts[],
): { messages: MessageWithParts[]; addedCount: number } {
  if (older.length === 0) return { messages: existing, addedCount: 0 };

  const existingIds = new Set(existing.map((m) => m.info.id));
  const unique = older.filter((m) => !existingIds.has(m.info.id));
  if (unique.length === 0) return { messages: existing, addedCount: 0 };

  return { messages: [...unique, ...existing], addedCount: unique.length };
}

// Merge a lazily-fetched full single message, replacing its truncated parts
// with the full versions in place (order preserved).
export function mergeFullMessage(
  existing: MessageWithParts[],
  full: MessageWithParts,
): MessageWithParts[] {
  let found = false;
  const next = existing.map((message) => {
    if (message.info.id !== full.info.id) return message;
    found = true;
    return { info: full.info, parts: full.parts };
  });
  return found ? next : existing;
}
