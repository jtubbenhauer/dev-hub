import { describe, it, expect } from "vitest"
import { buildTrie, matchKeys, getChildEntries, getNodeAtBuffer } from "@/lib/leader-key-trie"
import type { LeaderBindingsMap } from "@/types/leader-key"

describe("leader-key-trie", () => {
  describe("buildTrie", () => {
    it("only includes bindings for registered actions", () => {
      const bindings: LeaderBindingsMap = {
        "action.open": "o",
        "action.close": "c",
        "action.save": "s",
      }
      const registered = new Set(["action.open", "action.save"])
      const root = buildTrie(bindings, registered)

      expect(root.children.has("o")).toBe(true)
      expect(root.children.has("s")).toBe(true)
      expect(root.children.has("c")).toBe(false)
    })

    it("ignores actions not in the registered set", () => {
      const bindings: LeaderBindingsMap = { "ghost.action": "g" }
      const root = buildTrie(bindings, new Set())

      expect(root.children.size).toBe(0)
    })

    it("builds multi-key sequences as nested nodes", () => {
      const bindings: LeaderBindingsMap = { "git.push": "g p" }
      const registered = new Set(["git.push"])
      const root = buildTrie(bindings, registered)

      const gNode = root.children.get("g")
      expect(gNode).toBeDefined()
      expect(gNode!.actionId).toBeUndefined()

      const pNode = gNode!.children.get("p")
      expect(pNode).toBeDefined()
      expect(pNode!.actionId).toBe("git.push")
    })

    it("shares prefix nodes between overlapping bindings", () => {
      const bindings: LeaderBindingsMap = {
        "git.push": "g p",
        "git.pull": "g l",
      }
      const registered = new Set(["git.push", "git.pull"])
      const root = buildTrie(bindings, registered)

      const gNode = root.children.get("g")
      expect(gNode).toBeDefined()
      expect(gNode!.children.size).toBe(2)
      expect(gNode!.children.get("p")!.actionId).toBe("git.push")
      expect(gNode!.children.get("l")!.actionId).toBe("git.pull")
    })

    it("handles empty key strings gracefully", () => {
      const bindings: LeaderBindingsMap = { "empty.action": "" }
      const registered = new Set(["empty.action"])
      const root = buildTrie(bindings, registered)

      expect(root.children.size).toBe(0)
    })

    it("handles keys with extra whitespace", () => {
      const bindings: LeaderBindingsMap = { "action.x": "  a   b  " }
      const registered = new Set(["action.x"])
      const root = buildTrie(bindings, registered)

      const aNode = root.children.get("a")
      expect(aNode).toBeDefined()
      expect(aNode!.children.get("b")!.actionId).toBe("action.x")
    })
  })

  describe("matchKeys", () => {
    const bindings: LeaderBindingsMap = {
      "file.open": "f o",
      "file.save": "f s",
      "quit": "q",
    }
    const registered = new Set(["file.open", "file.save", "quit"])
    const root = buildTrie(bindings, registered)

    it("returns exact match when full key sequence is pressed", () => {
      const result = matchKeys(root, ["q"])
      expect(result.kind).toBe("exact")
      if (result.kind === "exact") {
        expect(result.actionId).toBe("quit")
      }
    })

    it("returns prefix match when sequence is incomplete", () => {
      const result = matchKeys(root, ["f"])
      expect(result.kind).toBe("prefix")
      if (result.kind === "prefix") {
        expect(result.children.size).toBe(2)
      }
    })

    it("returns none when no key matches", () => {
      const result = matchKeys(root, ["z"])
      expect(result.kind).toBe("none")
    })

    it("returns none when sequence goes past the trie", () => {
      const result = matchKeys(root, ["q", "x"])
      expect(result.kind).toBe("none")
    })

    it("returns exact match for multi-key sequence", () => {
      const result = matchKeys(root, ["f", "o"])
      expect(result.kind).toBe("exact")
      if (result.kind === "exact") {
        expect(result.actionId).toBe("file.open")
      }
    })

    it("reports hasChildren correctly on exact matches", () => {
      // "q" is a leaf — no children
      const qResult = matchKeys(root, ["q"])
      expect(qResult.kind).toBe("exact")
      if (qResult.kind === "exact") {
        expect(qResult.hasChildren).toBe(false)
      }
    })

    it("handles an action that is also a prefix for deeper bindings", () => {
      const overlapping: LeaderBindingsMap = {
        "group": "g",
        "group.sub": "g s",
      }
      const reg = new Set(["group", "group.sub"])
      const trie = buildTrie(overlapping, reg)

      const gResult = matchKeys(trie, ["g"])
      expect(gResult.kind).toBe("exact")
      if (gResult.kind === "exact") {
        expect(gResult.actionId).toBe("group")
        expect(gResult.hasChildren).toBe(true)
      }
    })

    it("returns none for an empty buffer", () => {
      const result = matchKeys(root, [])
      // root has children and no actionId, so this is a prefix
      expect(result.kind).toBe("prefix")
    })
  })

  describe("getChildEntries", () => {
    it("returns sorted child entries for which-key display", () => {
      const bindings: LeaderBindingsMap = {
        "nav.down": "n d",
        "nav.up": "n u",
        "nav.all": "n a",
      }
      const registered = new Set(["nav.down", "nav.up", "nav.all"])
      const root = buildTrie(bindings, registered)
      const nNode = root.children.get("n")!

      const entries = getChildEntries(nNode)
      expect(entries.map((e) => e.key)).toEqual(["a", "d", "u"])
    })

    it("includes actionId for leaf entries", () => {
      const bindings: LeaderBindingsMap = { "test.action": "t" }
      const registered = new Set(["test.action"])
      const root = buildTrie(bindings, registered)

      const entries = getChildEntries(root)
      expect(entries).toHaveLength(1)
      expect(entries[0].actionId).toBe("test.action")
      expect(entries[0].hasChildren).toBe(false)
    })

    it("marks entries with sub-bindings as having children", () => {
      const bindings: LeaderBindingsMap = {
        "group.a": "g a",
        "group.b": "g b",
      }
      const registered = new Set(["group.a", "group.b"])
      const root = buildTrie(bindings, registered)

      const entries = getChildEntries(root)
      expect(entries).toHaveLength(1)
      expect(entries[0].key).toBe("g")
      expect(entries[0].hasChildren).toBe(true)
      expect(entries[0].actionId).toBeUndefined()
    })
  })

  describe("getNodeAtBuffer", () => {
    const bindings: LeaderBindingsMap = {
      "a.b.c": "a b c",
    }
    const registered = new Set(["a.b.c"])
    const root = buildTrie(bindings, registered)

    it("returns the root node for an empty buffer", () => {
      expect(getNodeAtBuffer(root, [])).toBe(root)
    })

    it("walks to the correct intermediate node", () => {
      const node = getNodeAtBuffer(root, ["a"])
      expect(node).not.toBeNull()
      expect(node!.children.has("b")).toBe(true)
    })

    it("returns null for a non-existent path", () => {
      expect(getNodeAtBuffer(root, ["z"])).toBeNull()
    })

    it("returns null when path diverges partway", () => {
      expect(getNodeAtBuffer(root, ["a", "x"])).toBeNull()
    })

    it("returns the leaf node at the end of a full sequence", () => {
      const node = getNodeAtBuffer(root, ["a", "b", "c"])
      expect(node).not.toBeNull()
      expect(node!.actionId).toBe("a.b.c")
    })
  })
})
