import { describe, it, expect, beforeEach } from "vitest";
import { useSidePanelStore } from "@/stores/side-panel-store";

const initialState = {
  isOpen: false,
  activeTab: "files" as const,
  activePanelTab: "status" as const,
  openFiles: [] as {
    path: string;
    name: string;
    content: string;
    language: string;
    isDirty: boolean;
    originalContent: string;
  }[],
  activeFilePath: null as string | null,
  isFilePickerOpen: false,
  isLoading: false,
  error: null as string | null,
  expandedPaths: [] as string[],
  workspaceFileStates: {} as Record<
    string,
    {
      files: { path: string; name: string; language: string }[];
      activeFilePath: string | null;
    }
  >,
};

function resetStore() {
  useSidePanelStore.setState(initialState);
}

function getActiveFile() {
  const { openFiles, activeFilePath } = useSidePanelStore.getState();
  return openFiles.find((f) => f.path === activeFilePath) ?? null;
}

describe("default state", () => {
  beforeEach(resetStore);

  it("has correct default values", () => {
    const state = useSidePanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.activeTab).toBe("files");
    expect(state.isFilePickerOpen).toBe(false);
    expect(state.activePanelTab).toBe("status");
  });
});

describe("activePanelTab", () => {
  beforeEach(resetStore);

  it("defaults to status", () => {
    expect(useSidePanelStore.getState().activePanelTab).toBe("status");
  });

  it("setActivePanelTab changes the panel tab", () => {
    useSidePanelStore.getState().setActivePanelTab("files");
    expect(useSidePanelStore.getState().activePanelTab).toBe("files");

    useSidePanelStore.getState().setActivePanelTab("status");
    expect(useSidePanelStore.getState().activePanelTab).toBe("status");
  });
});

describe("openFileInTab", () => {
  beforeEach(resetStore);

  it("adds a new tab and sets it active", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");

    const state = useSidePanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeFilePath).toBe("src/utils.ts");
    expect(state.openFiles).toHaveLength(1);
    expect(state.openFiles[0].path).toBe("src/utils.ts");
    expect(state.openFiles[0].content).toBe("const x = 1;");
    expect(state.openFiles[0].originalContent).toBe("const x = 1;");
    expect(state.openFiles[0].isDirty).toBe(false);
    expect(state.openFiles[0].language).toBe("typescript");
    expect(state.openFiles[0].name).toBe("utils.ts");
    expect(state.error).toBeNull();
  });

  it("sets activePanelTab to files", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");

    expect(useSidePanelStore.getState().activePanelTab).toBe("files");
  });

  it("sets activePanelTab to files even when switching to existing tab", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().setActivePanelTab("status");

    useSidePanelStore
      .getState()
      .openFileInTab("src/a.ts", "fresh", "typescript");

    expect(useSidePanelStore.getState().activePanelTab).toBe("files");
  });

  it("switches to existing tab without reloading content", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");
    useSidePanelStore.getState().updateFileContent("src/a.ts", "aaa-modified");

    useSidePanelStore
      .getState()
      .openFileInTab("src/a.ts", "fresh-content", "typescript");

    const state = useSidePanelStore.getState();
    expect(state.activeFilePath).toBe("src/a.ts");
    expect(state.openFiles).toHaveLength(2);
    const aFile = state.openFiles.find((f) => f.path === "src/a.ts");
    expect(aFile?.content).toBe("aaa-modified");
  });

  it("opens multiple tabs", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");

    const state = useSidePanelStore.getState();
    expect(state.openFiles).toHaveLength(2);
    expect(state.activeFilePath).toBe("src/b.ts");
  });
});

describe("openFile (backward compat)", () => {
  beforeEach(resetStore);

  it("delegates to openFileInTab", () => {
    useSidePanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");

    const state = useSidePanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeFilePath).toBe("src/utils.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("closeTab", () => {
  beforeEach(resetStore);

  it("removes the tab", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().closeTab("src/a.ts");

    const state = useSidePanelStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
  });

  it("activates right neighbor when closing active tab", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");
    useSidePanelStore.getState().openFileInTab("src/c.ts", "ccc", "typescript");
    useSidePanelStore.getState().setActiveTab("src/b.ts");

    useSidePanelStore.getState().closeTab("src/b.ts");

    const state = useSidePanelStore.getState();
    expect(state.openFiles).toHaveLength(2);
    expect(state.activeFilePath).toBe("src/c.ts");
  });

  it("activates left neighbor when closing last tab in list", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");

    useSidePanelStore.getState().closeTab("src/b.ts");

    const state = useSidePanelStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFilePath).toBe("src/a.ts");
  });

  it("does not change activeFilePath when closing non-active tab", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");

    useSidePanelStore.getState().closeTab("src/a.ts");

    const state = useSidePanelStore.getState();
    expect(state.activeFilePath).toBe("src/b.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("setActiveTab", () => {
  beforeEach(resetStore);

  it("sets activeFilePath", () => {
    useSidePanelStore.getState().openFileInTab("src/a.ts", "aaa", "typescript");
    useSidePanelStore.getState().openFileInTab("src/b.ts", "bbb", "typescript");

    useSidePanelStore.getState().setActiveTab("src/a.ts");
    expect(useSidePanelStore.getState().activeFilePath).toBe("src/a.ts");
  });
});

describe("updateFileContent", () => {
  beforeEach(resetStore);

  it("updates content and marks dirty when different from original", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 2;");

    const file = getActiveFile();
    expect(file?.content).toBe("const x = 2;");
    expect(file?.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 2;");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSidePanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 1;");
    expect(getActiveFile()?.isDirty).toBe(false);
  });
});

describe("setContent (operates on active tab)", () => {
  beforeEach(resetStore);

  it("updates active tab content", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().setContent("const x = 2;");

    const file = getActiveFile();
    expect(file?.content).toBe("const x = 2;");
    expect(file?.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().setContent("const x = 2;");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSidePanelStore.getState().setContent("const x = 1;");
    expect(getActiveFile()?.isDirty).toBe(false);
  });
});

describe("markFileSaved", () => {
  beforeEach(resetStore);

  it("resets dirty and updates originalContent for specific file", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().updateFileContent("src/utils.ts", "modified");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSidePanelStore.getState().markFileSaved("src/utils.ts");

    const file = getActiveFile();
    expect(file?.isDirty).toBe(false);
    expect(file?.originalContent).toBe("modified");
  });
});

describe("markSaved (operates on active tab)", () => {
  beforeEach(resetStore);

  it("resets dirty and updates originalContent to current content", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().setContent("modified");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSidePanelStore.getState().markSaved();

    const file = getActiveFile();
    expect(file?.isDirty).toBe(false);
    expect(file?.originalContent).toBe("modified");
  });
});

describe("closePanel", () => {
  beforeEach(resetStore);

  it("sets isOpen to false while preserving file state", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().closePanel();

    const state = useSidePanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeFilePath).toBe("src/utils.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("clearFile", () => {
  beforeEach(resetStore);

  it("resets openFiles and activeFilePath", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().setContent("modified");
    useSidePanelStore.getState().clearFile();

    const state = useSidePanelStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe("togglePanel", () => {
  beforeEach(resetStore);

  it("flips isOpen on each call", () => {
    expect(useSidePanelStore.getState().isOpen).toBe(false);
    useSidePanelStore.getState().togglePanel();
    expect(useSidePanelStore.getState().isOpen).toBe(true);
    useSidePanelStore.getState().togglePanel();
    expect(useSidePanelStore.getState().isOpen).toBe(false);
  });

  it("preserves activePanelTab across close/open cycle", () => {
    useSidePanelStore.getState().setActivePanelTab("files");
    useSidePanelStore.getState().togglePanel();
    expect(useSidePanelStore.getState().isOpen).toBe(true);
    expect(useSidePanelStore.getState().activePanelTab).toBe("files");

    useSidePanelStore.getState().togglePanel();
    expect(useSidePanelStore.getState().isOpen).toBe(false);
    expect(useSidePanelStore.getState().activePanelTab).toBe("files");

    useSidePanelStore.getState().togglePanel();
    expect(useSidePanelStore.getState().isOpen).toBe(true);
    expect(useSidePanelStore.getState().activePanelTab).toBe("files");
  });
});

describe("setError and clearError", () => {
  beforeEach(resetStore);

  it("setError sets error message and clears isLoading", () => {
    useSidePanelStore.getState().setIsLoading(true);
    useSidePanelStore.getState().setError("not found");

    const state = useSidePanelStore.getState();
    expect(state.error).toBe("not found");
    expect(state.isLoading).toBe(false);
  });

  it("clearError removes the error message", () => {
    useSidePanelStore.getState().setError("not found");
    useSidePanelStore.getState().clearError();

    expect(useSidePanelStore.getState().error).toBeNull();
  });
});

describe("toggleFilePicker", () => {
  beforeEach(resetStore);

  it("toggles isFilePickerOpen on each call", () => {
    expect(useSidePanelStore.getState().isFilePickerOpen).toBe(false);
    useSidePanelStore.getState().toggleFilePicker();
    expect(useSidePanelStore.getState().isFilePickerOpen).toBe(true);
    useSidePanelStore.getState().toggleFilePicker();
    expect(useSidePanelStore.getState().isFilePickerOpen).toBe(false);
  });
});

describe("setIsLoading", () => {
  beforeEach(resetStore);

  it("sets isLoading to true and false", () => {
    useSidePanelStore.getState().setIsLoading(true);
    expect(useSidePanelStore.getState().isLoading).toBe(true);

    useSidePanelStore.getState().setIsLoading(false);
    expect(useSidePanelStore.getState().isLoading).toBe(false);
  });
});

describe("toggleExpandedPath", () => {
  beforeEach(resetStore);

  it("adds a path to expandedPaths", () => {
    useSidePanelStore.getState().toggleExpandedPath("src");
    expect(useSidePanelStore.getState().expandedPaths).toEqual(["src"]);
  });

  it("removes a path that is already expanded", () => {
    useSidePanelStore.getState().toggleExpandedPath("src");
    useSidePanelStore.getState().toggleExpandedPath("src");
    expect(useSidePanelStore.getState().expandedPaths).toEqual([]);
  });

  it("handles multiple distinct paths", () => {
    useSidePanelStore.getState().toggleExpandedPath("src");
    useSidePanelStore.getState().toggleExpandedPath("lib");
    expect(useSidePanelStore.getState().expandedPaths).toContain("src");
    expect(useSidePanelStore.getState().expandedPaths).toContain("lib");
  });
});

describe("expandPathToFile", () => {
  beforeEach(resetStore);

  it("expands all parent directories of a file path", () => {
    useSidePanelStore.getState().expandPathToFile("src/lib/utils.ts");
    const paths = useSidePanelStore.getState().expandedPaths;
    expect(paths).toContain("src");
    expect(paths).toContain("src/lib");
    expect(paths).not.toContain("src/lib/utils.ts");
  });

  it("does not duplicate already-expanded paths", () => {
    useSidePanelStore.getState().toggleExpandedPath("src");
    useSidePanelStore.getState().expandPathToFile("src/lib/utils.ts");
    const paths = useSidePanelStore.getState().expandedPaths;
    expect(paths.filter((p) => p === "src")).toHaveLength(1);
  });

  it("handles a file at root level (no parent dirs)", () => {
    useSidePanelStore.getState().expandPathToFile("README.md");
    expect(useSidePanelStore.getState().expandedPaths).toEqual([]);
  });
});

describe("persistence partialize", () => {
  beforeEach(resetStore);

  it("persists isOpen, isFilePickerOpen, expandedPaths, and activePanelTab", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().setActivePanelTab("files");

    const partialize = useSidePanelStore.persist.getOptions().partialize!;
    const persisted = partialize(useSidePanelStore.getState());

    expect(persisted).toHaveProperty("isOpen");
    expect(persisted).toHaveProperty("isFilePickerOpen");
    expect(persisted).toHaveProperty("expandedPaths");
    expect(persisted).toHaveProperty("activePanelTab");

    expect(persisted).not.toHaveProperty("openFilePaths");
    expect(persisted).not.toHaveProperty("activeFilePath");
    expect(persisted).not.toHaveProperty("openFiles");
    expect(persisted).not.toHaveProperty("isLoading");
    expect(persisted).not.toHaveProperty("error");
  });
});

describe("persist key", () => {
  it("uses dev-hub:side-panel as persist key", () => {
    const name = useSidePanelStore.persist.getOptions().name;
    expect(name).toBe("dev-hub:side-panel");
  });
});

describe("saveWorkspaceFiles / getPersistedFiles", () => {
  beforeEach(resetStore);

  it("saves current openFiles metadata (no content) for a workspace", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/app.ts", "const x = 1;", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-1");

    const { files, activeFilePath } = useSidePanelStore
      .getState()
      .getPersistedFiles("ws-1");
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      path: "src/app.ts",
      name: "app.ts",
      language: "typescript",
    });
    expect(files[0]).not.toHaveProperty("content");
    expect(files[0]).not.toHaveProperty("originalContent");
    expect(activeFilePath).toBe("src/app.ts");
  });

  it("returns empty state for unknown workspace", () => {
    const { files, activeFilePath } = useSidePanelStore
      .getState()
      .getPersistedFiles("ws-unknown");
    expect(files).toEqual([]);
    expect(activeFilePath).toBeNull();
  });

  it("round-trip: save ws-1 and ws-2, restore both independently", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/a.ts", "// a", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-1");

    useSidePanelStore.getState().clearFile();
    useSidePanelStore
      .getState()
      .openFileInTab("src/b.ts", "// b", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-2");

    const ws1 = useSidePanelStore.getState().getPersistedFiles("ws-1");
    const ws2 = useSidePanelStore.getState().getPersistedFiles("ws-2");

    expect(ws1.files).toHaveLength(1);
    expect(ws1.files[0].path).toBe("src/a.ts");
    expect(ws2.files).toHaveLength(1);
    expect(ws2.files[0].path).toBe("src/b.ts");
  });

  it("overwrite: re-saving same workspace updates state", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/a.ts", "// a", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-1");

    useSidePanelStore.getState().clearFile();
    useSidePanelStore
      .getState()
      .openFileInTab("src/b.ts", "// b", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-1");

    const { files } = useSidePanelStore.getState().getPersistedFiles("ws-1");
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/b.ts");
  });

  it("workspaceFileStates is included in partialize output", () => {
    useSidePanelStore
      .getState()
      .openFileInTab("src/a.ts", "// a", "typescript");
    useSidePanelStore.getState().saveWorkspaceFiles("ws-1");

    const state = useSidePanelStore.getState();
    expect(state.workspaceFileStates).toBeDefined();
    expect(state.workspaceFileStates["ws-1"]).toBeDefined();
    expect(state.workspaceFileStates["ws-1"].files[0].path).toBe("src/a.ts");
  });
});
