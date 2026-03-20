import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import type { TerminalHandle } from "@/components/terminal/terminal-panel"

let capturedOnReady: ((handle: TerminalHandle) => void) | undefined
let capturedShellCommand: string | null | undefined
let capturedEnvOverrides: Record<string, string> | undefined
let capturedSessionId: string | undefined
let capturedAutoFocus: boolean | undefined

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: {
    shellCommand: string | null
    envOverrides?: Record<string, string>
    sessionId?: string
    autoFocus?: boolean
    onReady?: (handle: TerminalHandle) => void
  }) => {
    capturedOnReady = props.onReady
    capturedShellCommand = props.shellCommand
    capturedEnvOverrides = props.envOverrides
    capturedSessionId = props.sessionId
    capturedAutoFocus = props.autoFocus
    return <div data-testid="terminal-panel" />
  },
}))

vi.mock("@/hooks/use-settings", () => ({
  useNvimAppNameSetting: () => ({ nvimAppName: "devhub", isLoading: false }),
  useTerminalScrollbackSetting: () => ({ scrollback: 5000, isLoading: false }),
  useTerminalFontSetting: () => ({ terminalFont: "geist-mono" as const, isLoading: false }),
  terminalFontFamily: (font: string) =>
    font === "ibm-plex-mono-nerd"
      ? "BlexMonoNerdFontMono, monospace"
      : "var(--font-geist-mono), monospace",
}))

let mockFetchResponses: Array<{ ok: boolean; json: () => Promise<unknown> }> = []

function pushFetchResponse(ok: boolean, body: unknown) {
  mockFetchResponses.push({ ok, json: () => Promise.resolve(body) })
}

vi.stubGlobal("fetch", vi.fn((_url: string, _init?: RequestInit) => {
  const response = mockFetchResponses.shift()
  if (!response) return Promise.reject(new Error("No mock fetch response queued"))
  return Promise.resolve(response)
}))

import { NeovimEditor } from "@/components/editor/neovim-editor"

const noopOnChange = vi.fn()

describe("NeovimEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchResponses = []
    capturedOnReady = undefined
    capturedShellCommand = undefined
    capturedEnvOverrides = undefined
    capturedSessionId = undefined
    capturedAutoFocus = undefined
  })

  describe("missing workspace or file path", () => {
    it("shows error when workspaceId is missing", () => {
      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          filePath="src/foo.ts"
        />
      )

      expect(screen.getByText(/no workspace selected/i)).toBeInTheDocument()
    })

    it("shows error when filePath is missing", () => {
      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
        />
      )

      expect(screen.getByText(/no file selected/i)).toBeInTheDocument()
    })
  })

  describe("dependency check", () => {
    it("shows error when nvim is not installed", async () => {
      pushFetchResponse(true, { nvim: false })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/foo.ts"
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/neovim is not installed/i)).toBeInTheDocument()
      })
    })
  })

  describe("terminal resolve and rendering", () => {
    it("renders TerminalPanel after successful resolve", async () => {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/main.ts"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      expect(capturedShellCommand).toBe("nvim 'src/main.ts'")
      expect(capturedSessionId).toBe("nvim-file-editor")
      expect(capturedAutoFocus).toBe(false)
    })

    it("passes autoFocus through to TerminalPanel when set", async () => {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/main.ts"
          autoFocus
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      expect(capturedAutoFocus).toBe(true)
    })

    it("passes NVIM_APPNAME env when appName is not 'personal'", async () => {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/main.ts"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      expect(capturedEnvOverrides).toEqual({ NVIM_APPNAME: "devhub" })
    })
  })

  describe("file switching via PTY", () => {
    async function setupWithTerminal(filePath = "src/foo.ts") {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      const result = render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath={filePath}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      return result
    }

    it("sends :e command when handleTerminalReady fires", async () => {
      await setupWithTerminal("src/foo.ts")

      const mockHandle: TerminalHandle = { write: vi.fn() }
      act(() => capturedOnReady?.(mockHandle))

      expect(mockHandle.write).toHaveBeenCalledWith("\x1b")
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r")
      })
    })

    it("sends :e on file change via re-render", async () => {
      const { rerender } = await setupWithTerminal("src/foo.ts")

      const mockHandle: TerminalHandle = { write: vi.fn() }
      act(() => capturedOnReady?.(mockHandle))

      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r")
      })

      vi.mocked(mockHandle.write).mockClear()

      rerender(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/bar.ts"
        />
      )

      expect(mockHandle.write).toHaveBeenCalledWith("\x1b")
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/bar.ts\r")
      })
    })

    it("does not resend :e when file path is unchanged", async () => {
      const { rerender } = await setupWithTerminal("src/foo.ts")

      const mockHandle: TerminalHandle = { write: vi.fn() }
      act(() => capturedOnReady?.(mockHandle))

      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r")
      })

      vi.mocked(mockHandle.write).mockClear()

      rerender(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/foo.ts"
        />
      )

      expect(mockHandle.write).not.toHaveBeenCalled()
    })

    it("catches up desired file if switch requested before handle ready", async () => {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      const { rerender } = render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/first.ts"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      // Change file before terminal is ready
      rerender(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/second.ts"
        />
      )

      // Now terminal becomes ready
      const mockHandle: TerminalHandle = { write: vi.fn() }
      act(() => capturedOnReady?.(mockHandle))

      expect(mockHandle.write).toHaveBeenCalledWith("\x1b")
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/second.ts\r")
      })

      expect(mockHandle.write).not.toHaveBeenCalledWith(":e src/first.ts\r")
    })
  })

  describe("shell command construction", () => {
    it("escapes single quotes in file paths", async () => {
      pushFetchResponse(true, { nvim: true })
      pushFetchResponse(true, { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null })

      render(
        <NeovimEditor
          content="hello"
          language="typescript"
          onChange={noopOnChange}
          workspaceId="ws-1"
          filePath="src/it's a file.ts"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument()
      })

      expect(capturedShellCommand).toBe("nvim 'src/it'\\''s a file.ts'")
    })
  })
})
