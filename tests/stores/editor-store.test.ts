import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/stores/editor-store";
import type { OpenFile } from "@/types";
import { fileTabContract } from "./file-tab-contract";

fileTabContract({
  getState: useEditorStore.getState,
  reset: () => useEditorStore.getState().closeAllFiles(),
  open: (workspaceId) =>
    useEditorStore
      .getState()
      .openFile({ ...makeFile("a.ts", workspaceId ?? "base"), workspaceId }),
  close: () => useEditorStore.getState().closeFile("a.ts"),
});

function makeFile(path: string, content = "original"): OpenFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "typescript",
    isDirty: false,
    originalContent: content,
  };
}

function resetStore() {
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    isFileTreeOpen: true,
    diffViewMode: "unified",
  });
}

describe("openFile", () => {
  beforeEach(resetStore);

  it("adds a file to openFiles and sets it as active", () => {
    const file = makeFile("src/index.ts");
    useEditorStore.getState().openFile(file);

    const state = useEditorStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.openFiles[0].path).toBe("src/index.ts");
    expect(state.activeFilePath).toBe("src/index.ts");
  });

  it("does not duplicate an already-open file", () => {
    const file = makeFile("src/index.ts");
    useEditorStore.getState().openFile(file);
    useEditorStore.getState().openFile(file);

    expect(useEditorStore.getState().openFiles).toHaveLength(1);
  });

  it("activates an already-open file without adding a duplicate", () => {
    const fileA = makeFile("a.ts");
    const fileB = makeFile("b.ts");
    useEditorStore.getState().openFile(fileA);
    useEditorStore.getState().openFile(fileB);
    expect(useEditorStore.getState().activeFilePath).toBe("b.ts");

    useEditorStore.getState().openFile(fileA);
    expect(useEditorStore.getState().activeFilePath).toBe("a.ts");
    expect(useEditorStore.getState().openFiles).toHaveLength(2);
  });

  it("opens multiple distinct files", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    useEditorStore.getState().openFile(makeFile("c.ts"));

    expect(useEditorStore.getState().openFiles).toHaveLength(3);
    expect(useEditorStore.getState().activeFilePath).toBe("c.ts");
  });
});

describe("closeFile", () => {
  beforeEach(resetStore);

  it("removes the file from openFiles", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    useEditorStore.getState().closeFile("a.ts");

    const paths = useEditorStore.getState().openFiles.map((f) => f.path);
    expect(paths).toEqual(["b.ts"]);
  });

  it("sets activeFilePath to null when the last file is closed", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().closeFile("a.ts");

    expect(useEditorStore.getState().activeFilePath).toBeNull();
    expect(useEditorStore.getState().openFiles).toHaveLength(0);
  });

  it("selects the next file at the same index when the active file is closed", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    useEditorStore.getState().openFile(makeFile("c.ts"));
    useEditorStore.getState().setActiveFile("b.ts");

    useEditorStore.getState().closeFile("b.ts");
    // b.ts was at index 1. After removal, c.ts moves to index 1.
    expect(useEditorStore.getState().activeFilePath).toBe("c.ts");
  });

  it("selects the last file when closing the file at the end", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    // b.ts is active (last opened)
    useEditorStore.getState().closeFile("b.ts");

    expect(useEditorStore.getState().activeFilePath).toBe("a.ts");
  });

  it("does not change activeFilePath when closing a non-active file", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    // b.ts is active
    useEditorStore.getState().closeFile("a.ts");

    expect(useEditorStore.getState().activeFilePath).toBe("b.ts");
  });
});

describe("updateFileContent (dirty tracking)", () => {
  beforeEach(resetStore);

  it("marks a file dirty when content differs from originalContent", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "original"));
    useEditorStore.getState().updateFileContent("a.ts", "modified");

    const file = useEditorStore.getState().openFiles[0];
    expect(file.isDirty).toBe(true);
    expect(file.content).toBe("modified");
  });

  it("marks a file clean when content matches originalContent", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "original"));
    useEditorStore.getState().updateFileContent("a.ts", "modified");
    useEditorStore.getState().updateFileContent("a.ts", "original");

    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false);
  });

  it("does not affect other open files", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "aaa"));
    useEditorStore.getState().openFile(makeFile("b.ts", "bbb"));
    useEditorStore.getState().updateFileContent("a.ts", "changed");

    const files = useEditorStore.getState().openFiles;
    expect(files.find((f) => f.path === "a.ts")!.isDirty).toBe(true);
    expect(files.find((f) => f.path === "b.ts")!.isDirty).toBe(false);
  });
});

describe("markFileSaved", () => {
  beforeEach(resetStore);

  it("clears isDirty and updates originalContent to current content", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "v1"));
    useEditorStore.getState().updateFileContent("a.ts", "v2");
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true);

    useEditorStore.getState().markFileSaved("a.ts");

    const file = useEditorStore.getState().openFiles[0];
    expect(file.isDirty).toBe(false);
    expect(file.originalContent).toBe("v2");
    expect(file.content).toBe("v2");
  });

  it("subsequent edits are tracked against the new saved content", () => {
    useEditorStore.getState().openFile(makeFile("a.ts", "v1"));
    useEditorStore.getState().updateFileContent("a.ts", "v2");
    useEditorStore.getState().markFileSaved("a.ts");

    // editing back to v1 should be dirty (original is now v2)
    useEditorStore.getState().updateFileContent("a.ts", "v1");
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true);

    // editing back to v2 should be clean
    useEditorStore.getState().updateFileContent("a.ts", "v2");
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false);
  });
});

describe("toggleFileTree / setFileTreeOpen", () => {
  beforeEach(resetStore);

  it("toggles file tree", () => {
    expect(useEditorStore.getState().isFileTreeOpen).toBe(true);
    useEditorStore.getState().toggleFileTree();
    expect(useEditorStore.getState().isFileTreeOpen).toBe(false);
    useEditorStore.getState().toggleFileTree();
    expect(useEditorStore.getState().isFileTreeOpen).toBe(true);
  });

  it("sets file tree open state directly", () => {
    useEditorStore.getState().setFileTreeOpen(false);
    expect(useEditorStore.getState().isFileTreeOpen).toBe(false);
  });
});

describe("closeAllFiles", () => {
  beforeEach(resetStore);

  it("removes all files and clears activeFilePath", () => {
    useEditorStore.getState().openFile(makeFile("a.ts"));
    useEditorStore.getState().openFile(makeFile("b.ts"));
    useEditorStore.getState().closeAllFiles();

    expect(useEditorStore.getState().openFiles).toHaveLength(0);
    expect(useEditorStore.getState().activeFilePath).toBeNull();
  });
});

describe("toggleDiffViewMode / setDiffViewMode", () => {
  beforeEach(resetStore);

  it("defaults to unified", () => {
    expect(useEditorStore.getState().diffViewMode).toBe("unified");
  });

  it("toggles between unified and side-by-side", () => {
    useEditorStore.getState().toggleDiffViewMode();
    expect(useEditorStore.getState().diffViewMode).toBe("side-by-side");
    useEditorStore.getState().toggleDiffViewMode();
    expect(useEditorStore.getState().diffViewMode).toBe("unified");
  });

  it("sets diff view mode directly", () => {
    useEditorStore.getState().setDiffViewMode("side-by-side");
    expect(useEditorStore.getState().diffViewMode).toBe("side-by-side");
    useEditorStore.getState().setDiffViewMode("unified");
    expect(useEditorStore.getState().diffViewMode).toBe("unified");
  });
});

function makeOwnedFile(path: string, workspaceId: string): OpenFile {
  return { ...makeFile(path), workspaceId };
}

function resetWorkspaceTabs() {
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    workspaceFileStates: {},
  });
}

describe("saveWorkspaceState", () => {
  beforeEach(resetWorkspaceTabs);

  it("saves only the tabs that belong to the workspace", () => {
    // Given
    const { openFile } = useEditorStore.getState();
    openFile(makeOwnedFile("a.ts", "ws-A"));
    openFile(makeFile("unowned.ts"));
    openFile(makeOwnedFile("b.ts", "ws-B"));

    // When
    useEditorStore.getState().saveWorkspaceState("ws-A");

    // Then
    const saved = useEditorStore.getState().workspaceFileStates["ws-A"];
    expect(saved.tabs.map((tab) => tab.path)).toEqual(["a.ts", "unowned.ts"]);
    expect(saved.activeFilePath).toBeNull();
  });
});

describe("releaseOtherWorkspaceTabs", () => {
  beforeEach(resetWorkspaceTabs);

  it("closes clean tabs from other workspaces and saves them for their owner", () => {
    // Given
    const { openFile } = useEditorStore.getState();
    openFile(makeOwnedFile("a1.ts", "ws-A"));
    openFile(makeOwnedFile("a2.ts", "ws-A"));

    // When
    useEditorStore.getState().releaseOtherWorkspaceTabs("ws-B");

    // Then
    const state = useEditorStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.workspaceFileStates["ws-A"]).toMatchObject({
      tabs: [
        { path: "a1.ts", name: "a1.ts", language: "typescript" },
        { path: "a2.ts", name: "a2.ts", language: "typescript" },
      ],
      activeFilePath: "a2.ts",
    });
  });

  it("keeps dirty tabs from other workspaces open so edits are not lost", () => {
    // Given
    const { openFile, updateFileContent } = useEditorStore.getState();
    openFile(makeOwnedFile("a1.ts", "ws-A"));
    openFile(makeOwnedFile("a2.ts", "ws-A"));
    updateFileContent("a1.ts", "unsaved edit");

    // When
    useEditorStore.getState().releaseOtherWorkspaceTabs("ws-B");

    // Then
    const state = useEditorStore.getState();
    expect(state.openFiles.map((file) => file.path)).toEqual(["a1.ts"]);
    expect(state.openFiles[0].content).toBe("unsaved edit");
  });

  it("activates one of the workspace's own tabs when the active tab is released", () => {
    // Given
    const { openFile } = useEditorStore.getState();
    openFile(makeOwnedFile("b1.ts", "ws-B"));
    openFile(makeOwnedFile("a1.ts", "ws-A"));

    // When
    useEditorStore.getState().releaseOtherWorkspaceTabs("ws-B");

    // Then
    const state = useEditorStore.getState();
    expect(state.openFiles.map((file) => file.path)).toEqual(["b1.ts"]);
    expect(state.activeFilePath).toBe("b1.ts");
  });

  it("leaves the store untouched when every tab belongs to the workspace", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("b1.ts", "ws-B"));
    const before = useEditorStore.getState();

    // When
    useEditorStore.getState().releaseOtherWorkspaceTabs("ws-B");

    // Then
    expect(useEditorStore.getState()).toBe(before);
  });
});

const revealInput = {
  workspaceId: "ws-A",
  path: "src/a.ts",
  lineNumber: 12,
  startColumn: 5,
  endColumn: 11,
  startByteColumn: 7,
  lineSha256: "abc123",
} as const;

describe("requestReveal / clearReveal", () => {
  beforeEach(() => useEditorStore.setState({ pendingReveal: null }));

  it("assigns increasing ids and keeps the request fields", () => {
    // Given
    useEditorStore.getState().requestReveal(revealInput);
    const firstId = useEditorStore.getState().pendingReveal?.id ?? 0;

    // When
    useEditorStore
      .getState()
      .requestReveal({ ...revealInput, lineSha256: "def456" });

    // Then
    expect(useEditorStore.getState().pendingReveal).toEqual({
      ...revealInput,
      lineSha256: "def456",
      id: firstId + 1,
    });
  });

  it("ignores a stale id and keeps the newer request", () => {
    // Given
    useEditorStore.getState().requestReveal(revealInput);
    const staleId = useEditorStore.getState().pendingReveal?.id ?? 0;
    useEditorStore.getState().requestReveal({ ...revealInput, lineNumber: 3 });
    const newer = useEditorStore.getState().pendingReveal;

    // When
    useEditorStore.getState().clearReveal(staleId);

    // Then
    expect(useEditorStore.getState().pendingReveal).toBe(newer);
    expect(newer?.lineNumber).toBe(3);
  });

  it("clears the request when the id matches", () => {
    // Given
    useEditorStore.getState().requestReveal(revealInput);
    const currentId = useEditorStore.getState().pendingReveal?.id ?? 0;

    // When
    useEditorStore.getState().clearReveal(currentId);

    // Then
    expect(useEditorStore.getState().pendingReveal).toBeNull();
  });

  it("never persists the pending reveal", () => {
    // Given
    useEditorStore.getState().requestReveal(revealInput);
    const partialize = useEditorStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();

    // When
    const persisted = partialize?.(useEditorStore.getState());

    // Then
    expect(persisted).toBeDefined();
    expect(persisted).not.toHaveProperty("pendingReveal");
  });
});

describe("refreshCleanTabFromDisk", () => {
  beforeEach(resetWorkspaceTabs);

  it("replaces the content of a clean tab", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("a.ts", "ws-A"));

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "a.ts", "from disk");

    // Then
    expect(result).toBe("replaced");
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "from disk",
      originalContent: "from disk",
      isDirty: false,
      workspaceId: "ws-A",
    });
  });

  it("adopts a clean legacy tab without a workspaceId", () => {
    // Given
    useEditorStore.getState().openFile(makeFile("a.ts"));

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "a.ts", "original");

    // Then
    expect(result).toBe("replaced");
    expect(useEditorStore.getState().openFiles[0].workspaceId).toBe("ws-A");
  });

  it("returns unchanged without touching the store when content already matches", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("a.ts", "ws-A"));
    const openFilesBefore = useEditorStore.getState().openFiles;

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "a.ts", "original");

    // Then
    expect(result).toBe("unchanged");
    expect(useEditorStore.getState().openFiles).toBe(openFilesBefore);
  });

  it("skips a dirty tab", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("a.ts", "ws-A"));
    useEditorStore.getState().updateFileContent("a.ts", "unsaved edit");

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "a.ts", "from disk");

    // Then
    expect(result).toBe("dirty-skipped");
    expect(useEditorStore.getState().openFiles[0].content).toBe("unsaved edit");
  });

  it("ignores a tab owned by another workspace", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("a.ts", "ws-B"));

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "a.ts", "from disk");

    // Then
    expect(result).toBe("not-open");
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "original",
      workspaceId: "ws-B",
    });
  });

  it("returns not-open for a path that is not open", () => {
    // Given
    useEditorStore.getState().openFile(makeOwnedFile("a.ts", "ws-A"));

    // When
    const result = useEditorStore
      .getState()
      .refreshCleanTabFromDisk("ws-A", "missing.ts", "from disk");

    // Then
    expect(result).toBe("not-open");
  });
});
