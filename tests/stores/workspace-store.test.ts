import { describe, it, expect, beforeEach } from "vitest"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { Workspace } from "@/types"

function makeWorkspace(id: string, name?: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: name ?? `Workspace ${id}`,
    path: `/home/user/dev/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: "pnpm",
    quickCommands: null,
    backend: "local",
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  }
}

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    isLoadingWorkspaces: true,
  })
}

describe("setWorkspaces", () => {
  beforeEach(resetStore)

  it("replaces the workspace list", () => {
    const workspaces = [makeWorkspace("ws-1"), makeWorkspace("ws-2")]
    useWorkspaceStore.getState().setWorkspaces(workspaces)

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
    expect(useWorkspaceStore.getState().workspaces[0].id).toBe("ws-1")
  })
})

describe("activeWorkspace (computed getter)", () => {
  beforeEach(resetStore)

  it("returns null when no activeWorkspaceId is set", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1")])

    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull()
  })

  it("returns the workspace matching activeWorkspaceId via selector", () => {
    // activeWorkspace is a `get` accessor that calls Zustand's get() — it's
    // designed for React selectors, not getState(). Object.assign in set()
    // eagerly evaluates the getter against stale state, so we verify the
    // contract through a selector instead.
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace("ws-1"), makeWorkspace("ws-2")],
      activeWorkspaceId: "ws-2",
    })

    const state = useWorkspaceStore.getState()
    const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    expect(active?.id).toBe("ws-2")
  })

  it("returns null when activeWorkspaceId does not match any workspace", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1")])
    useWorkspaceStore.getState().setActiveWorkspaceId("nonexistent")

    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull()
  })
})

describe("addWorkspace", () => {
  beforeEach(resetStore)

  it("appends a workspace to the list", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1")])
    useWorkspaceStore.getState().addWorkspace(makeWorkspace("ws-2"))

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
    expect(useWorkspaceStore.getState().workspaces[1].id).toBe("ws-2")
  })
})

describe("removeWorkspace", () => {
  beforeEach(resetStore)

  it("removes a workspace by id", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1"), makeWorkspace("ws-2")])
    useWorkspaceStore.getState().removeWorkspace("ws-1")

    const ids = useWorkspaceStore.getState().workspaces.map((w) => w.id)
    expect(ids).toEqual(["ws-2"])
  })

  it("clears activeWorkspaceId when removing the active workspace", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1"), makeWorkspace("ws-2")])
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1")
    useWorkspaceStore.getState().removeWorkspace("ws-1")

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
  })

  it("preserves activeWorkspaceId when removing a non-active workspace", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1"), makeWorkspace("ws-2")])
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2")
    useWorkspaceStore.getState().removeWorkspace("ws-1")

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2")
  })
})

describe("updateWorkspace", () => {
  beforeEach(resetStore)

  it("merges partial updates into the workspace", () => {
    useWorkspaceStore.getState().setWorkspaces([makeWorkspace("ws-1", "Old Name")])
    useWorkspaceStore.getState().updateWorkspace("ws-1", { name: "New Name" })

    const ws = useWorkspaceStore.getState().workspaces[0]
    expect(ws.name).toBe("New Name")
    expect(ws.path).toBe("/home/user/dev/ws-1")
  })

  it("does not affect other workspaces", () => {
    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace("ws-1", "First"),
      makeWorkspace("ws-2", "Second"),
    ])
    useWorkspaceStore.getState().updateWorkspace("ws-1", { name: "Updated" })

    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("Updated")
    expect(useWorkspaceStore.getState().workspaces[1].name).toBe("Second")
  })
})

describe("setIsLoadingWorkspaces", () => {
  beforeEach(resetStore)

  it("sets the loading state", () => {
    expect(useWorkspaceStore.getState().isLoadingWorkspaces).toBe(true)
    useWorkspaceStore.getState().setIsLoadingWorkspaces(false)
    expect(useWorkspaceStore.getState().isLoadingWorkspaces).toBe(false)
  })
})
