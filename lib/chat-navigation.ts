import type { MessageWithParts } from "@/lib/opencode/types";

// Search is strict (> / < anchor) so repeated presses always move; null = no move.

export function computeNextUserMessageIndex(
  messages: readonly MessageWithParts[],
  anchorIndex: number,
): number | null {
  const start = Math.max(anchorIndex, -1) + 1;
  for (let i = start; i < messages.length; i++) {
    if (messages[i].info.role === "user") return i;
  }
  return null;
}

export function computePrevUserMessageIndex(
  messages: readonly MessageWithParts[],
  anchorIndex: number,
): number | null {
  const start = Math.min(anchorIndex, messages.length) - 1;
  for (let i = start; i >= 0; i--) {
    if (messages[i].info.role === "user") return i;
  }
  return null;
}

export function computeFirstUserMessageIndex(
  messages: readonly MessageWithParts[],
): number | null {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].info.role === "user") return i;
  }
  return null;
}

export function computeLastUserMessageIndex(
  messages: readonly MessageWithParts[],
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") return i;
  }
  return null;
}
