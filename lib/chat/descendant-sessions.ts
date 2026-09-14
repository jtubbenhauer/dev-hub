import type { Session } from "@/lib/opencode/types";

export interface DescendantSessionsResult {
  ids: string[];
  truncated: boolean;
}

// Walks the parent->child session tree breadth-first starting from
// parentSessionId, ordering each sibling group by creation time (stable tie
// break on id). Returns at most `cap` descendant ids; `truncated` is true when
// more reachable descendants existed than the cap allowed.
export function collectDescendantSessionIds(
  sessions: Record<string, Session>,
  parentSessionId: string,
  cap: number,
): DescendantSessionsResult {
  const childrenByParent = new Map<string, string[]>();
  for (const session of Object.values(sessions)) {
    if (!session.parentID) continue;
    const siblings = childrenByParent.get(session.parentID) ?? [];
    siblings.push(session.id);
    childrenByParent.set(session.parentID, siblings);
  }

  const sortByCreated = (a: string, b: string): number => {
    const createdA = sessions[a]?.time?.created ?? 0;
    const createdB = sessions[b]?.time?.created ?? 0;
    if (createdA !== createdB) return createdA - createdB;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };

  const ordered: string[] = [];
  const visited = new Set<string>([parentSessionId]);
  const queue: string[] = [
    ...(childrenByParent.get(parentSessionId) ?? []),
  ].sort(sortByCreated);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ordered.push(id);
    const children = [...(childrenByParent.get(id) ?? [])].sort(sortByCreated);
    queue.push(...children);
  }

  const truncated = ordered.length > cap;
  const ids = truncated ? ordered.slice(0, cap) : ordered;
  return { ids, truncated };
}
