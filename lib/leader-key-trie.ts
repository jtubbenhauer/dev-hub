import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key"

export interface TrieNode {
  children: Map<string, TrieNode>
  actionId?: string
}

export type MatchResult =
  | { kind: "exact"; actionId: string; hasChildren: boolean }
  | { kind: "prefix"; children: Map<string, TrieNode> }
  | { kind: "none" }

export function buildTrie(
  bindings: LeaderBindingsMap,
  registeredActionIds: Set<string>
): TrieNode {
  const root: TrieNode = { children: new Map() }

  for (const [actionId, keys] of Object.entries(bindings)) {
    // Only build trie entries for actions that are currently registered
    if (!registeredActionIds.has(actionId)) continue

    const keySequence = keys.split(" ").filter(Boolean)
    if (keySequence.length === 0) continue

    let node = root
    for (const key of keySequence) {
      let child = node.children.get(key)
      if (!child) {
        child = { children: new Map() }
        node.children.set(key, child)
      }
      node = child
    }
    node.actionId = actionId
  }

  return root
}

export function matchKeys(root: TrieNode, keyBuffer: string[]): MatchResult {
  let node = root
  for (const key of keyBuffer) {
    const child = node.children.get(key)
    if (!child) return { kind: "none" }
    node = child
  }

  if (node.actionId !== undefined) {
    return { kind: "exact", actionId: node.actionId, hasChildren: node.children.size > 0 }
  }

  if (node.children.size > 0) {
    return { kind: "prefix", children: node.children }
  }

  return { kind: "none" }
}

// Returns all (key, actionId) leaf entries reachable from a given node, for which-key display
export function getChildEntries(node: TrieNode): Array<{ key: string; actionId: string | undefined; hasChildren: boolean }> {
  const entries: Array<{ key: string; actionId: string | undefined; hasChildren: boolean }> = []
  for (const [key, child] of node.children) {
    entries.push({ key, actionId: child.actionId, hasChildren: child.children.size > 0 })
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

// Walk the trie to get the node at a given key buffer position (for which-key)
export function getNodeAtBuffer(root: TrieNode, keyBuffer: string[]): TrieNode | null {
  let node = root
  for (const key of keyBuffer) {
    const child = node.children.get(key)
    if (!child) return null
    node = child
  }
  return node
}
