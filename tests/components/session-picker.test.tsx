import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  SessionPickerProvider,
  SessionPickerDialog,
  useSessionPicker,
} from "@/components/session-picker/session-picker"
import { useChatStore } from "@/stores/chat-store"
import { useWorkspaceStore } from "@/stores/workspace-store"

// Mock next/navigation
const mockPush = vi.fn()
const mockPathname = vi.fn(() => "/chat")
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname(),
}))

function makeSession(id: string, title: string, updated: number) {
  return {
    id,
    slug: id,
    projectID: "proj-1",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: 1000, updated },
  }
}

function seedStores(sessions: ReturnType<typeof makeSession>[], workspaceId = "ws-1") {
  const sessionsMap: Record<string, ReturnType<typeof makeSession>> = {}
  for (const s of sessions) {
    sessionsMap[s.id] = s
  }

  useChatStore.setState({
    activeWorkspaceId: workspaceId,
    activeSessionId: null,
    workspaceStates: {
      [workspaceId]: {
        sessions: sessionsMap,
        sessionsLoaded: true,
        pinnedSessionIds: new Set(),
        messages: {},
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {},
        sessionAgents: {},
        lastViewedAt: {},
      },
    },
  })

  useWorkspaceStore.setState({
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        userId: "user-1",
        name: "Test Workspace",
        path: "/workspace",
        type: "repo" as const,
        parentRepoPath: null,
        packageManager: null,
        quickCommands: null,
        backend: "local" as const,
        provider: null,
        opencodeUrl: null,
        agentUrl: null,
        providerMeta: null,
        shellCommand: null,
        worktreeSymlinks: null,
        linkedTaskId: null,
        linkedTaskMeta: null,
        color: null,
        createdAt: new Date("2025-01-01"),
        lastAccessedAt: new Date("2025-01-01"),
      },
    ],
  })
}

function resetStores() {
  useChatStore.setState({
    activeWorkspaceId: null,
    activeSessionId: null,
    workspaceStates: {},
  })
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    workspaces: [],
  })
}

// Helper to open the picker via the context hook
function OpenButton() {
  const { open } = useSessionPicker()
  return <button onClick={open}>Open Picker</button>
}

function renderPicker() {
  return render(
    <SessionPickerProvider>
      <OpenButton />
      <SessionPickerDialog />
    </SessionPickerProvider>,
  )
}

// jsdom stubs for APIs used by Radix ScrollArea and scroll-into-view
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

Element.prototype.scrollIntoView = () => {}

describe("SessionPickerDialog", () => {
  beforeEach(() => {
    resetStores()
    mockPush.mockClear()
    mockPathname.mockReturnValue("/chat")
  })

  it("does not render dialog content when closed", () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    expect(screen.queryByPlaceholderText("Search sessions...")).not.toBeInTheDocument()
  })

  it("renders dialog content when opened", async () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))

    expect(screen.getByPlaceholderText("Search sessions...")).toBeInTheDocument()
    expect(screen.getByText("My Session")).toBeInTheDocument()
  })

  it("shows 'New Session' entry when no search query", async () => {
    seedStores([makeSession("s1", "First Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))

    expect(screen.getByText("New Session")).toBeInTheDocument()
  })

  it("hides 'New Session' entry when searching", async () => {
    seedStores([makeSession("s1", "First Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.type(screen.getByPlaceholderText("Search sessions..."), "First")

    expect(screen.queryByText("New Session")).not.toBeInTheDocument()
  })

  it("filters sessions by search query", async () => {
    seedStores([
      makeSession("s1", "Fix the bug", 2000),
      makeSession("s2", "Add feature", 1000),
    ])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.type(screen.getByPlaceholderText("Search sessions..."), "bug")

    // Fuzzy highlights split text across spans — match via button textContent
    const sessionButtons = screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("data-index") !== null,
    )
    expect(sessionButtons.some((btn) => btn.textContent?.includes("Fix the bug"))).toBe(true)
    expect(sessionButtons.some((btn) => btn.textContent?.includes("Add feature"))).toBe(false)
  })

  it("sorts sessions by most recently updated", async () => {
    seedStores([
      makeSession("s1", "Older Session", 1000),
      makeSession("s2", "Newer Session", 3000),
    ])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))

    const buttons = screen.getAllByRole("button").filter(
      (btn) => btn.textContent?.includes("Session"),
    )
    // "New Session" is first, then "Newer Session", then "Older Session"
    expect(buttons[0]).toHaveTextContent("New Session")
    expect(buttons[1]).toHaveTextContent("Newer Session")
    expect(buttons[2]).toHaveTextContent("Older Session")
  })

  it("selects session and sets it as active", async () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.click(screen.getByText("My Session"))

    expect(useChatStore.getState().activeSessionId).toBe("s1")
  })

  it("closes dialog on Escape", async () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    expect(screen.getByPlaceholderText("Search sessions...")).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    expect(screen.queryByPlaceholderText("Search sessions...")).not.toBeInTheDocument()
  })

  it("navigates to /chat when selecting from another page", async () => {
    mockPathname.mockReturnValue("/git")
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.click(screen.getByText("My Session"))

    expect(mockPush).toHaveBeenCalledWith("/chat")
  })

  it("does not navigate when already on /chat", async () => {
    mockPathname.mockReturnValue("/chat")
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.click(screen.getByText("My Session"))

    expect(mockPush).not.toHaveBeenCalled()
  })

  it("keyboard navigates with ArrowDown and selects with Enter", async () => {
    seedStores([
      makeSession("s1", "First Session", 2000),
      makeSession("s2", "Second Session", 1000),
    ])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))

    // ArrowDown past "New Session" to "First Session", then to "Second Session"
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}")

    expect(useChatStore.getState().activeSessionId).toBe("s2")
  })

  it("shows workspace name next to sessions", async () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))

    const workspaceLabels = screen.getAllByText("Test Workspace")
    expect(workspaceLabels.length).toBeGreaterThanOrEqual(1)
  })

  it("shows 'No sessions match' when search has no results", async () => {
    seedStores([makeSession("s1", "My Session", 2000)])
    renderPicker()

    await userEvent.click(screen.getByText("Open Picker"))
    await userEvent.type(screen.getByPlaceholderText("Search sessions..."), "zzzzzzzzz")

    expect(screen.getByText("No sessions match")).toBeInTheDocument()
  })
})
