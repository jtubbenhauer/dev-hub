import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useTerminalStore } from "@/stores/terminal-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { Workspace } from "@/types"

let capturedAutoFocus: boolean | undefined

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: { autoFocus?: boolean }) => {
    capturedAutoFocus = props.autoFocus
    return <div data-testid="terminal-panel" />
  },
}))

vi.mock("@/hooks/use-settings", () => ({
  useTerminalScrollbackSetting: () => ({ scrollback: 5000, isLoading: false }),
  useTerminalFontSetting: () => ({ terminalFont: "geist-mono" as const, isLoading: false }),
  terminalFontFamily: () => "var(--font-geist-mono), monospace",
}))

let mockFetchResponses: Array<{ ok: boolean; json: () => Promise<unknown> }> = []

function pushFetchResponse(ok: boolean, body: unknown) {
  mockFetchResponses.push({ ok, json: () => Promise.resolve(body) })
}

vi.stubGlobal("fetch", vi.fn(() => {
  const response = mockFetchResponses.shift()
  if (!response) return Promise.reject(new Error("No mock fetch response queued"))
  return Promise.resolve(response)
}))

import { TerminalDrawer } from "@/components/terminal/terminal-drawer"

const TEST_WORKSPACE: Workspace = {
  id: "ws-1",
  userId: "user-1",
  name: "test-project",
  path: "/home/test/project",
  type: "repo",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  backend: "local",
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
}

describe("TerminalDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchResponses = []
    capturedAutoFocus = undefined
    useTerminalStore.setState({ isOpen: false })
    useWorkspaceStore.setState({
      workspaces: [TEST_WORKSPACE],
      activeWorkspaceId: "ws-1",
    })
  })

  it("does not pass autoFocus (defaults to true in TerminalPanel)", async () => {
    const resolveBody = { wsUrl: "ws://localhost:3001", cwd: "/home/test", shellCommand: null }
    pushFetchResponse(true, resolveBody)
    useTerminalStore.setState({ isOpen: true })

    render(<TerminalDrawer />)

    await waitFor(() => {
      expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
    })

    expect(capturedAutoFocus).toBeUndefined()
  })

  it("toggles open/closed with Ctrl+`", async () => {
    render(<TerminalDrawer />)

    expect(useTerminalStore.getState().isOpen).toBe(false)

    await userEvent.keyboard("{Control>}`{/Control}")

    expect(useTerminalStore.getState().isOpen).toBe(true)

    await userEvent.keyboard("{Control>}`{/Control}")

    expect(useTerminalStore.getState().isOpen).toBe(false)
  })

  it("shows 'select a workspace' when no workspace is active", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null })
    useTerminalStore.setState({ isOpen: true })

    render(<TerminalDrawer />)

    expect(screen.getByText(/select a workspace/i)).toBeInTheDocument()
  })

  it("shows error when resolve fails", async () => {
    pushFetchResponse(false, { error: "Connection refused" })
    useTerminalStore.setState({ isOpen: true })

    render(<TerminalDrawer />)

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument()
    })
  })
})
