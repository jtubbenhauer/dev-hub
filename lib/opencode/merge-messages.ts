import type { MessageWithParts, Part } from "@/lib/opencode/types";
import { getPartTruncation } from "@/lib/opencode/truncate-messages";

const OPTIMISTIC_CLOCK_SKEW_MS = 5_000;

export interface RecoveredMessageEntry {
  sequence: number;
  message: MessageWithParts;
}

export function mergeRecoveredMessages(
  authoritative: MessageWithParts[],
  recovered: RecoveredMessageEntry[],
): MessageWithParts[] {
  const recoveredById = new Map(
    recovered.map((entry) => [entry.message.info.id, entry.message]),
  );
  // A shared id means both copies describe the same turn. Authoritative info
  // always wins, but archived parts are kept wherever the authoritative copy
  // is only a truncated view of content the archive still holds in full.
  const reconciled = authoritative.map((message) => {
    const archived = recoveredById.get(message.info.id);
    if (!archived) return message;
    const candidate = mergeMessage(archived, message);
    const unchanged =
      candidate.parts.length === message.parts.length &&
      candidate.parts.every((part, index) => part === message.parts[index]);
    return unchanged ? message : candidate;
  });

  const authoritativeIds = new Set(
    authoritative.map((message) => message.info.id),
  );
  const recoveredOnly = recovered
    .filter((entry) => !authoritativeIds.has(entry.message.info.id))
    .sort(
      (left, right) =>
        left.message.info.time.created - right.message.info.time.created ||
        left.sequence - right.sequence,
    );
  if (recoveredOnly.length === 0) return reconciled;

  const merged: MessageWithParts[] = [];
  let authoritativeIndex = 0;
  let recoveredIndex = 0;
  while (
    authoritativeIndex < reconciled.length &&
    recoveredIndex < recoveredOnly.length
  ) {
    const authoritativeMessage = reconciled[authoritativeIndex];
    const recoveredEntry = recoveredOnly[recoveredIndex];
    if (
      recoveredEntry.message.info.time.created <=
      authoritativeMessage.info.time.created
    ) {
      merged.push(recoveredEntry.message);
      recoveredIndex += 1;
    } else {
      merged.push(authoritativeMessage);
      authoritativeIndex += 1;
    }
  }
  merged.push(...reconciled.slice(authoritativeIndex));
  merged.push(
    ...recoveredOnly.slice(recoveredIndex).map((entry) => entry.message),
  );
  return merged;
}

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

  const existingIndexById = new Map(
    existing.map((message, index) => [message.info.id, index]),
  );
  const hasOverlap = incoming.some((message) =>
    existingIndexById.has(message.info.id),
  );

  // A tail window is always the newest slice, so if it shares nothing with
  // existing, existing must be older history — keep it before the window.
  if (!hasOverlap) {
    return [...existing, ...incoming];
  }

  const merged: MessageWithParts[] = [];
  const mergedIndexById = new Map<string, number>();
  const pendingIncoming: MessageWithParts[] = [];
  let existingIndex = 0;

  // Incoming order can contradict the order already held (a message moved
  // behind an anchor we consumed). Folding a repeat id into its emitted slot
  // keeps every id exactly once instead of appending a second copy.
  const emit = (message: MessageWithParts): void => {
    const emittedIndex = mergedIndexById.get(message.info.id);
    if (emittedIndex !== undefined) {
      merged[emittedIndex] = mergeMessage(merged[emittedIndex], message);
      return;
    }
    mergedIndexById.set(message.info.id, merged.length);
    merged.push(message);
  };

  for (const incomingMessage of incoming) {
    const overlapIndex = existingIndexById.get(incomingMessage.info.id);
    if (overlapIndex === undefined || overlapIndex < existingIndex) {
      pendingIncoming.push(incomingMessage);
      continue;
    }

    for (const older of existing.slice(existingIndex, overlapIndex))
      emit(older);
    for (const pending of pendingIncoming.splice(0)) emit(pending);
    emit(mergeMessage(existing[overlapIndex], incomingMessage));
    existingIndex = overlapIndex + 1;
  }

  for (const pending of pendingIncoming) emit(pending);
  for (const older of existing.slice(existingIndex)) emit(older);
  return merged;
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

// Drop optimistic-prefixed user messages from `messages` whose text already
// appears as a real user message in `authoritative` (a fresh server window).
// Guards against the "message shown twice" bug when the SSE `message.updated`
// filter can't fire — either the SSE event was dropped, or a prior refresh
// cleared the tracking mapping before the SSE arrived, leaving the optimistic
// stranded in the array (typically at the very end, via mergeTailWindow's
// suffix). Returns removed IDs so callers can clear the tracking mapping.
export function dropSupersededOptimistic(
  messages: MessageWithParts[],
  authoritative: MessageWithParts[],
): { messages: MessageWithParts[]; removedIds: Set<string> } {
  const realUserTimesByText = new Map<string, number[]>();
  for (const m of authoritative) {
    if (m.info.role !== "user") continue;
    if (m.info.id.startsWith("optimistic-")) continue;
    const text = extractTextContent(m);
    if (!text) continue;
    const times = realUserTimesByText.get(text) ?? [];
    times.push(m.info.time.created);
    realUserTimesByText.set(text, times);
  }
  if (realUserTimesByText.size === 0) {
    return { messages, removedIds: new Set() };
  }

  const removedIds = new Set<string>();
  const next = messages.filter((m) => {
    if (!m.info.id.startsWith("optimistic-")) return true;
    if (m.info.role !== "user") return true;
    const text = extractTextContent(m);
    const candidateTimes = text ? realUserTimesByText.get(text) : undefined;
    const matchingIndex = candidateTimes?.findIndex(
      (created) => created >= m.info.time.created - OPTIMISTIC_CLOCK_SKEW_MS,
    );
    if (matchingIndex !== undefined && matchingIndex >= 0 && candidateTimes) {
      candidateTimes.splice(matchingIndex, 1);
      removedIds.add(m.info.id);
      return false;
    }
    return true;
  });

  if (removedIds.size === 0) {
    return { messages, removedIds };
  }
  return { messages: next, removedIds };
}

function extractTextContent(message: MessageWithParts): string {
  let out = "";
  for (const part of message.parts) {
    if (part.type !== "text") continue;
    if ("ignored" in part && part.ignored) continue;
    out += part.text;
  }
  return out;
}
