import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { OpenFile } from "@/types"

const storeFns = {
  setActiveFile: vi.fn(),
  closeFile: vi.fn(),
  closeAllFiles: vi.fn(),
}

let storeState: Record<string, unknown> = {}

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(storeState)
  ),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild, ...props }: { children: React.ReactNode; asChild?: boolean; [k: string]: unknown }) =>
    asChild ? <>{children}</> : <span {...props}>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>,
}))

import { OpenEditors } from "@/components/editor/open-editors"

function makeFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path: "/src/foo.ts",
    name: "foo.ts",
    content: "const x = 1",
    language: "typescript",
    isDirty: false,
    originalContent: "const x = 1",
    ...overrides,
  }
}

function mockStoreState(files: OpenFile[], activeFilePath: string | null = null) {
  storeState = {
    openFiles: files,
    activeFilePath,
    ...storeFns,
  }
}

describe("OpenEditors", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState = {}
  })

  describe("empty state", () => {
    it("renders nothing when no files are open", () => {
      mockStoreState([])
      const { container } = render(<OpenEditors />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe("header", () => {
    it("renders the header with file count", () => {
      const files = [
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ]
      mockStoreState(files)
      render(<OpenEditors />)
      expect(screen.getByText("Open Editors")).toBeInTheDocument()
      expect(screen.getByText("(2)")).toBeInTheDocument()
    })

    it("renders close all button", () => {
      mockStoreState([makeFile()])
      render(<OpenEditors />)
      expect(screen.getByRole("button", { name: /close all/i })).toBeInTheDocument()
    })
  })

  describe("file list", () => {
    it("renders all open files by name", () => {
      const files = [
        makeFile({ path: "/src/a.ts", name: "a.ts" }),
        makeFile({ path: "/src/b.ts", name: "b.ts" }),
        makeFile({ path: "/src/c.ts", name: "c.ts" }),
      ]
      mockStoreState(files)
      render(<OpenEditors />)
      expect(screen.getByText("a.ts")).toBeInTheDocument()
      expect(screen.getByText("b.ts")).toBeInTheDocument()
      expect(screen.getByText("c.ts")).toBeInTheDocument()
    })

    it("shows dirty indicator for modified files", () => {
      mockStoreState([makeFile({ isDirty: true, name: "dirty.ts", path: "/dirty.ts" })])
      render(<OpenEditors />)
      expect(screen.getByText("●")).toBeInTheDocument()
    })

    it("does not show dirty indicator for clean files", () => {
      mockStoreState([makeFile({ isDirty: false })])
      render(<OpenEditors />)
      expect(screen.queryByText("●")).not.toBeInTheDocument()
    })

    it("renders close button for each file", () => {
      const files = [
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ]
      mockStoreState(files)
      render(<OpenEditors />)
      expect(screen.getByRole("button", { name: "Close a.ts" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Close b.ts" })).toBeInTheDocument()
    })
  })

  describe("interactions", () => {
    it("calls setActiveFile when clicking a file row", async () => {
      const user = userEvent.setup()
      mockStoreState(
        [makeFile({ path: "/src/target.ts", name: "target.ts" })],
        null
      )
      render(<OpenEditors />)
      await user.click(screen.getByText("target.ts"))
      expect(storeFns.setActiveFile).toHaveBeenCalledWith("/src/target.ts")
    })

    it("calls closeFile when clicking the close button on a file", async () => {
      const user = userEvent.setup()
      mockStoreState([makeFile({ path: "/src/bye.ts", name: "bye.ts" })])
      render(<OpenEditors />)
      await user.click(screen.getByRole("button", { name: "Close bye.ts" }))
      expect(storeFns.closeFile).toHaveBeenCalledWith("/src/bye.ts")
    })

    it("calls closeAllFiles when clicking the close all button", async () => {
      const user = userEvent.setup()
      mockStoreState([makeFile()])
      render(<OpenEditors />)
      await user.click(screen.getByRole("button", { name: /close all/i }))
      expect(storeFns.closeAllFiles).toHaveBeenCalledOnce()
    })
  })

  describe("collapse/expand", () => {
    it("hides file list when collapse toggle is clicked", async () => {
      const user = userEvent.setup()
      mockStoreState([makeFile({ path: "/src/hidden.ts", name: "hidden.ts" })])
      render(<OpenEditors />)
      expect(screen.getByText("hidden.ts")).toBeInTheDocument()

      await user.click(screen.getByText("Open Editors"))
      expect(screen.queryByText("hidden.ts")).not.toBeInTheDocument()
    })

    it("shows file list again when expanded after collapse", async () => {
      const user = userEvent.setup()
      mockStoreState([makeFile({ path: "/src/toggle.ts", name: "toggle.ts" })])
      render(<OpenEditors />)

      await user.click(screen.getByText("Open Editors"))
      expect(screen.queryByText("toggle.ts")).not.toBeInTheDocument()


      await user.click(screen.getByText("Open Editors"))
      expect(screen.getByText("toggle.ts")).toBeInTheDocument()
    })

    it("still shows header with file count when collapsed", async () => {
      const user = userEvent.setup()
      mockStoreState([
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ])
      render(<OpenEditors />)
      await user.click(screen.getByText("Open Editors"))
      expect(screen.getByText("Open Editors")).toBeInTheDocument()
      expect(screen.getByText("(2)")).toBeInTheDocument()
    })
  })

  describe("active file highlighting", () => {
    it("applies active styling to the currently active file", () => {
      const files = [
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ]
      mockStoreState(files, "/b.ts")
      const { container } = render(<OpenEditors />)
      const rows = container.querySelectorAll("[class*='group']")
      expect(rows[1]?.className).toContain("bg-accent")
      expect(rows[0]?.className).not.toContain("bg-accent")
    })
  })
})
