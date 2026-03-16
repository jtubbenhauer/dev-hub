import { describe, it, expect, beforeEach } from "vitest"
import { useEditorStore } from "@/stores/editor-store"
import type { OpenFile } from "@/types"

function makeFile(path: string, content = "original"): OpenFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "typescript",
    isDirty: false,
    originalContent: content,
  }
}

function resetStore() {
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    isVimMode: false,
    isFileTreeOpen: true,
    diffViewMode: "unified",
  })
}

describe("openFile", () => {
  beforeEach(resetStore)

  it("adds a file to openFiles and sets it as active", () => {
    const file = makeFile("src/index.ts")
    useEditorStore.getState().openFile(file)

    const state = useEditorStore.getState()
    expect(state.openFiles).toHaveLength(1)
    expect(state.openFiles[0].path).toBe("src/index.ts")
    expect(state.activeFilePath).toBe("src/index.ts")
  })

  it("does not duplicate an already-open file", () => {
    const file = makeFile("src/index.ts")
    useEditorStore.getState().openFile(file)
    useEditorStore.getState().openFile(file)

    expect(useEditorStore.getState().openFiles).toHaveLength(1)
  })

  it("activates an already-open file without adding a duplicate", () => {
    const fileA = makeFile("a.ts")
    const fileB = makeFile("b.ts")
    useEditorStore.getState().openFile(fileA)
    useEditorStore.getState().openFile(fileB)
    expect(useEditorStore.getState().activeFilePath).toBe("b.ts")

    useEditorStore.getState().openFile(fileA)
    expect(useEditorStore.getState().activeFilePath).toBe("a.ts")
    expect(useEditorStore.getState().openFiles).toHaveLength(2)
  })

  it("opens multiple distinct files", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    useEditorStore.getState().openFile(makeFile("c.ts"))

    expect(useEditorStore.getState().openFiles).toHaveLength(3)
    expect(useEditorStore.getState().activeFilePath).toBe("c.ts")
  })
})

describe("closeFile", () => {
  beforeEach(resetStore)

  it("removes the file from openFiles", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    useEditorStore.getState().closeFile("a.ts")

    const paths = useEditorStore.getState().openFiles.map((f) => f.path)
    expect(paths).toEqual(["b.ts"])
  })

  it("sets activeFilePath to null when the last file is closed", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().closeFile("a.ts")

    expect(useEditorStore.getState().activeFilePath).toBeNull()
    expect(useEditorStore.getState().openFiles).toHaveLength(0)
  })

  it("selects the next file at the same index when the active file is closed", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    useEditorStore.getState().openFile(makeFile("c.ts"))
    useEditorStore.getState().setActiveFile("b.ts")

    useEditorStore.getState().closeFile("b.ts")
    // b.ts was at index 1. After removal, c.ts moves to index 1.
    expect(useEditorStore.getState().activeFilePath).toBe("c.ts")
  })

  it("selects the last file when closing the file at the end", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    // b.ts is active (last opened)
    useEditorStore.getState().closeFile("b.ts")

    expect(useEditorStore.getState().activeFilePath).toBe("a.ts")
  })

  it("does not change activeFilePath when closing a non-active file", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    // b.ts is active
    useEditorStore.getState().closeFile("a.ts")

    expect(useEditorStore.getState().activeFilePath).toBe("b.ts")
  })
})

describe("updateFileContent (dirty tracking)", () => {
  beforeEach(resetStore)

  it("marks a file dirty when content differs from originalContent", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "original"))
    useEditorStore.getState().updateFileContent("a.ts", "modified")

    const file = useEditorStore.getState().openFiles[0]
    expect(file.isDirty).toBe(true)
    expect(file.content).toBe("modified")
  })

  it("marks a file clean when content matches originalContent", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "original"))
    useEditorStore.getState().updateFileContent("a.ts", "modified")
    useEditorStore.getState().updateFileContent("a.ts", "original")

    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false)
  })

  it("does not affect other open files", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "aaa"))
    useEditorStore.getState().openFile(makeFile("b.ts", "bbb"))
    useEditorStore.getState().updateFileContent("a.ts", "changed")

    const files = useEditorStore.getState().openFiles
    expect(files.find((f) => f.path === "a.ts")!.isDirty).toBe(true)
    expect(files.find((f) => f.path === "b.ts")!.isDirty).toBe(false)
  })
})

describe("markFileSaved", () => {
  beforeEach(resetStore)

  it("clears isDirty and updates originalContent to current content", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "v1"))
    useEditorStore.getState().updateFileContent("a.ts", "v2")
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true)

    useEditorStore.getState().markFileSaved("a.ts")

    const file = useEditorStore.getState().openFiles[0]
    expect(file.isDirty).toBe(false)
    expect(file.originalContent).toBe("v2")
    expect(file.content).toBe("v2")
  })

  it("subsequent edits are tracked against the new saved content", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "v1"))
    useEditorStore.getState().updateFileContent("a.ts", "v2")
    useEditorStore.getState().markFileSaved("a.ts")

    // editing back to v1 should be dirty (original is now v2)
    useEditorStore.getState().updateFileContent("a.ts", "v1")
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true)

    // editing back to v2 should be clean
    useEditorStore.getState().updateFileContent("a.ts", "v2")
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false)
  })
})

describe("toggleVimMode / setVimMode", () => {
  beforeEach(resetStore)

  it("toggles vim mode", () => {
    expect(useEditorStore.getState().isVimMode).toBe(false)
    useEditorStore.getState().toggleVimMode()
    expect(useEditorStore.getState().isVimMode).toBe(true)
    useEditorStore.getState().toggleVimMode()
    expect(useEditorStore.getState().isVimMode).toBe(false)
  })

  it("sets vim mode directly", () => {
    useEditorStore.getState().setVimMode(true)
    expect(useEditorStore.getState().isVimMode).toBe(true)
    useEditorStore.getState().setVimMode(false)
    expect(useEditorStore.getState().isVimMode).toBe(false)
  })
})

describe("toggleFileTree / setFileTreeOpen", () => {
  beforeEach(resetStore)

  it("toggles file tree", () => {
    expect(useEditorStore.getState().isFileTreeOpen).toBe(true)
    useEditorStore.getState().toggleFileTree()
    expect(useEditorStore.getState().isFileTreeOpen).toBe(false)
    useEditorStore.getState().toggleFileTree()
    expect(useEditorStore.getState().isFileTreeOpen).toBe(true)
  })

  it("sets file tree open state directly", () => {
    useEditorStore.getState().setFileTreeOpen(false)
    expect(useEditorStore.getState().isFileTreeOpen).toBe(false)
  })
})

describe("closeAllFiles", () => {
  beforeEach(resetStore)

  it("removes all files and clears activeFilePath", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"))
    useEditorStore.getState().openFile(makeFile("b.ts"))
    useEditorStore.getState().closeAllFiles()

    expect(useEditorStore.getState().openFiles).toHaveLength(0)
    expect(useEditorStore.getState().activeFilePath).toBeNull()
  })
})

describe("toggleDiffViewMode / setDiffViewMode", () => {
  beforeEach(resetStore)

  it("defaults to unified", () => {
    expect(useEditorStore.getState().diffViewMode).toBe("unified")
  })

  it("toggles between unified and side-by-side", () => {
    useEditorStore.getState().toggleDiffViewMode()
    expect(useEditorStore.getState().diffViewMode).toBe("side-by-side")
    useEditorStore.getState().toggleDiffViewMode()
    expect(useEditorStore.getState().diffViewMode).toBe("unified")
  })

  it("sets diff view mode directly", () => {
    useEditorStore.getState().setDiffViewMode("side-by-side")
    expect(useEditorStore.getState().diffViewMode).toBe("side-by-side")
    useEditorStore.getState().setDiffViewMode("unified")
    expect(useEditorStore.getState().diffViewMode).toBe("unified")
  })
})
