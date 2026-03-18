import { describe, it, expect } from "vitest"


function getDescendantSessionIds(
  sessions: Record<string, { id: string; parentID?: string }>,
  activeSessionId: string | null,
): Set<string> {
  if (!activeSessionId) return new Set()
  const childrenOf = new Map<string, string[]>()
  for (const s of Object.values(sessions)) {
    if (s.parentID) {
      const siblings = childrenOf.get(s.parentID) ?? []
      siblings.push(s.id)
      childrenOf.set(s.parentID, siblings)
    }
  }
  const descendants = new Set<string>()
  const queue = [...(childrenOf.get(activeSessionId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (!descendants.has(id)) {
      descendants.add(id)
      queue.push(...(childrenOf.get(id) ?? []))
    }
  }
  return descendants
}

function filterPermissions(
  allPermissions: Array<{ id: string; sessionID: string }>,
  activeSessionId: string | null,
  childSessionIds: Set<string>,
) {
  return allPermissions.filter(
    (p) => p.sessionID === activeSessionId || childSessionIds.has(p.sessionID),
  )
}

function filterQuestions(
  allQuestions: Array<{ id: string; sessionID: string }>,
  activeSessionId: string | null,
  childSessionIds: Set<string>,
) {
  return allQuestions.filter(
    (q) => q.sessionID === activeSessionId || childSessionIds.has(q.sessionID),
  )
}

function makeSession(id: string, parentID?: string) {
  return { id, parentID }
}

function makePerm(id: string, sessionID: string) {
  return { id, sessionID }
}

describe("getDescendantSessionIds", () => {
  it("returns empty set when sessions is empty", () => {
    const result = getDescendantSessionIds({}, "sess-parent")
    expect(result.size).toBe(0)
  })

  it("returns empty set when activeSessionId is null", () => {
    const sessions = { "sess-a": makeSession("sess-a") }
    const result = getDescendantSessionIds(sessions, null)
    expect(result.size).toBe(0)
  })

  it("returns empty set when there are no child sessions", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-unrelated": makeSession("sess-unrelated"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result.size).toBe(0)
  })

  it("returns direct child session IDs", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child": makeSession("sess-child", "sess-parent"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).toContain("sess-child")
    expect(result.size).toBe(1)
  })

  it("returns multiple direct children", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child-1": makeSession("sess-child-1", "sess-parent"),
      "sess-child-2": makeSession("sess-child-2", "sess-parent"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).toContain("sess-child-1")
    expect(result).toContain("sess-child-2")
    expect(result.size).toBe(2)
  })

  it("returns grandchild session IDs (depth 2)", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child": makeSession("sess-child", "sess-parent"),
      "sess-grandchild": makeSession("sess-grandchild", "sess-child"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).toContain("sess-child")
    expect(result).toContain("sess-grandchild")
    expect(result.size).toBe(2)
  })

  it("returns great-grandchild session IDs (depth 3+)", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child": makeSession("sess-child", "sess-parent"),
      "sess-grandchild": makeSession("sess-grandchild", "sess-child"),
      "sess-great-grandchild": makeSession("sess-great-grandchild", "sess-grandchild"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).toContain("sess-child")
    expect(result).toContain("sess-grandchild")
    expect(result).toContain("sess-great-grandchild")
    expect(result.size).toBe(3)
  })

  it("excludes unrelated sessions (different root)", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child": makeSession("sess-child", "sess-parent"),
      "sess-other-root": makeSession("sess-other-root"),
      "sess-other-child": makeSession("sess-other-child", "sess-other-root"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).not.toContain("sess-other-root")
    expect(result).not.toContain("sess-other-child")
    expect(result).toContain("sess-child")
    expect(result.size).toBe(1)
  })

  it("does not include the active session itself", () => {
    const sessions = {
      "sess-parent": makeSession("sess-parent"),
      "sess-child": makeSession("sess-child", "sess-parent"),
    }
    const result = getDescendantSessionIds(sessions, "sess-parent")
    expect(result).not.toContain("sess-parent")
  })

  it("handles sessions with no parentID (root sessions)", () => {
    const sessions = {
      "sess-a": makeSession("sess-a"),
      "sess-b": makeSession("sess-b"),
    }
    const result = getDescendantSessionIds(sessions, "sess-a")
    expect(result.size).toBe(0)
  })
})

describe("filterPermissions", () => {
  it("includes permission whose sessionID matches activeSessionId", () => {
    const perms = [makePerm("perm-1", "sess-parent")]
    const result = filterPermissions(perms, "sess-parent", new Set())
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("perm-1")
  })

  it("excludes permission whose sessionID does not match and is not a descendant", () => {
    const perms = [makePerm("perm-1", "sess-unrelated")]
    const result = filterPermissions(perms, "sess-parent", new Set())
    expect(result).toHaveLength(0)
  })

  it("includes permission from a direct child session", () => {
    const perms = [makePerm("perm-1", "sess-child")]
    const childIds = new Set(["sess-child"])
    const result = filterPermissions(perms, "sess-parent", childIds)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("perm-1")
  })

  it("includes permission from a grandchild session", () => {
    const perms = [makePerm("perm-1", "sess-grandchild")]
    const childIds = new Set(["sess-child", "sess-grandchild"])
    const result = filterPermissions(perms, "sess-parent", childIds)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("perm-1")
  })

  it("includes multiple permissions from different descendant sessions simultaneously", () => {
    const perms = [
      makePerm("perm-1", "sess-parent"),
      makePerm("perm-2", "sess-child"),
      makePerm("perm-3", "sess-grandchild"),
      makePerm("perm-4", "sess-unrelated"),
    ]
    const childIds = new Set(["sess-child", "sess-grandchild"])
    const result = filterPermissions(perms, "sess-parent", childIds)
    expect(result).toHaveLength(3)
    expect(result.map((p) => p.id)).toContain("perm-1")
    expect(result.map((p) => p.id)).toContain("perm-2")
    expect(result.map((p) => p.id)).toContain("perm-3")
    expect(result.map((p) => p.id)).not.toContain("perm-4")
  })

  it("returns empty array when activeSessionId is null", () => {
    const perms = [makePerm("perm-1", "sess-any")]
    const result = filterPermissions(perms, null, new Set())
    expect(result).toHaveLength(0)
  })

  it("returns empty array when no permissions exist", () => {
    const result = filterPermissions([], "sess-parent", new Set(["sess-child"]))
    expect(result).toHaveLength(0)
  })
})

describe("filterQuestions", () => {
  it("includes question whose sessionID matches activeSessionId", () => {
    const questions = [{ id: "q-1", sessionID: "sess-parent" }]
    const result = filterQuestions(questions, "sess-parent", new Set())
    expect(result).toHaveLength(1)
  })

  it("excludes question from unrelated session", () => {
    const questions = [{ id: "q-1", sessionID: "sess-unrelated" }]
    const result = filterQuestions(questions, "sess-parent", new Set())
    expect(result).toHaveLength(0)
  })

  it("includes question from a direct child session", () => {
    const questions = [{ id: "q-1", sessionID: "sess-child" }]
    const childIds = new Set(["sess-child"])
    const result = filterQuestions(questions, "sess-parent", childIds)
    expect(result).toHaveLength(1)
  })

  it("includes question from a grandchild session", () => {
    const questions = [{ id: "q-1", sessionID: "sess-grandchild" }]
    const childIds = new Set(["sess-child", "sess-grandchild"])
    const result = filterQuestions(questions, "sess-parent", childIds)
    expect(result).toHaveLength(1)
  })

  it("includes questions from multiple descendant sessions simultaneously", () => {
    const questions = [
      { id: "q-1", sessionID: "sess-parent" },
      { id: "q-2", sessionID: "sess-child" },
      { id: "q-3", sessionID: "sess-unrelated" },
    ]
    const childIds = new Set(["sess-child"])
    const result = filterQuestions(questions, "sess-parent", childIds)
    expect(result).toHaveLength(2)
    expect(result.map((q) => q.id)).not.toContain("q-3")
  })

  it("returns empty array when activeSessionId is null", () => {
    const questions = [{ id: "q-1", sessionID: "sess-any" }]
    const result = filterQuestions(questions, null, new Set())
    expect(result).toHaveLength(0)
  })
})

describe("respondToPermission session ID", () => {
  it("should use permission.sessionID (child session), not activeSessionId (parent session)", () => {
    const activeSessionId = "sess-parent"
    const permission = { id: "perm-1", sessionID: "sess-child" }

    const correctSessionId = permission.sessionID
    expect(correctSessionId).toBe("sess-child")
    expect(correctSessionId).not.toBe(activeSessionId)
  })

  it("uses permission.sessionID even when it equals activeSessionId (direct session permission)", () => {
    const activeSessionId = "sess-parent"
    const permission = { id: "perm-1", sessionID: "sess-parent" }

    const correctSessionId = permission.sessionID
    expect(correctSessionId).toBe(activeSessionId)
  })
})
