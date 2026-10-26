import type { MessageWithParts } from "@/lib/opencode/types";

// The facade window is the newest slice of omo's active branch, so once a
// cached message shows up in it, every later message on that branch is in it
// too. Later cached messages missing from it belong to a branch omo moved away
// from (a rewind, or two processes forking the session tree). Merging them as
// leftovers would place the abandoned branch after the newest messages.
export function dropCachedMessagesOffActiveBranch(
  cachedMessages: readonly MessageWithParts[],
  activeBranchTail: readonly MessageWithParts[],
): MessageWithParts[] {
  const tailIds = new Set(activeBranchTail.map((message) => message.info.id));
  const firstOverlapIndex = cachedMessages.findIndex((message) =>
    tailIds.has(message.info.id),
  );
  if (firstOverlapIndex === -1) return [...cachedMessages];
  return cachedMessages.filter(
    (message, index) =>
      index < firstOverlapIndex || tailIds.has(message.info.id),
  );
}
