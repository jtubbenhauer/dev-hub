import { describe, it, expect, beforeEach } from "vitest";
import { useSplitPanelStore } from "@/stores/split-panel-store";

const initialState = {
  isOpen: false,
  activeTab: "files" as const,
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
};

function resetStore() {
  useSplitPanelStore.setState(initialState);
}

function getActiveFile() {
  const { openFiles, activeFilePath } = useSplitPanelStore.getState();
  return openFiles.find((f) => f.path === activeFilePath) ?? null;
}

describe("default state", () => {
  beforeEach(resetStore);

  it("has correct default values", () => {
    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.activeTab).toBe("files");
    expect(state.isFilePickerOpen).toBe(false);
  });
});

describe("openFileInTab", () => {
  beforeEach(resetStore);

  it("adds a new tab and sets it active", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");

    const state = useSplitPanelStore.getState();
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

  it("switches to existing tab without reloading content", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");
    useSplitPanelStore.getState().updateFileContent("src/a.ts", "aaa-modified");

    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "fresh-content", "typescript");

    const state = useSplitPanelStore.getState();
    expect(state.activeFilePath).toBe("src/a.ts");
    expect(state.openFiles).toHaveLength(2);
    const aFile = state.openFiles.find((f) => f.path === "src/a.ts");
    expect(aFile?.content).toBe("aaa-modified");
  });

  it("opens multiple tabs", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toHaveLength(2);
    expect(state.activeFilePath).toBe("src/b.ts");
  });
});

describe("openFile (backward compat)", () => {
  beforeEach(resetStore);

  it("delegates to openFileInTab", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeFilePath).toBe("src/utils.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("closeTab", () => {
  beforeEach(resetStore);

  it("removes the tab", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore.getState().closeTab("src/a.ts");

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
  });

  it("activates right neighbor when closing active tab", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/c.ts", "ccc", "typescript");
    useSplitPanelStore.getState().setActiveTab("src/b.ts");

    useSplitPanelStore.getState().closeTab("src/b.ts");

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toHaveLength(2);
    expect(state.activeFilePath).toBe("src/c.ts");
  });

  it("activates left neighbor when closing last tab in list", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");

    useSplitPanelStore.getState().closeTab("src/b.ts");

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFilePath).toBe("src/a.ts");
  });

  it("does not change activeFilePath when closing non-active tab", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");

    useSplitPanelStore.getState().closeTab("src/a.ts");

    const state = useSplitPanelStore.getState();
    expect(state.activeFilePath).toBe("src/b.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("setActiveTab", () => {
  beforeEach(resetStore);

  it("sets activeFilePath", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/a.ts", "aaa", "typescript");
    useSplitPanelStore
      .getState()
      .openFileInTab("src/b.ts", "bbb", "typescript");

    useSplitPanelStore.getState().setActiveTab("src/a.ts");
    expect(useSplitPanelStore.getState().activeFilePath).toBe("src/a.ts");
  });
});

describe("updateFileContent", () => {
  beforeEach(resetStore);

  it("updates content and marks dirty when different from original", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 2;");

    const file = getActiveFile();
    expect(file?.content).toBe("const x = 2;");
    expect(file?.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 2;");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSplitPanelStore
      .getState()
      .updateFileContent("src/utils.ts", "const x = 1;");
    expect(getActiveFile()?.isDirty).toBe(false);
  });
});

describe("setContent (operates on active tab)", () => {
  beforeEach(resetStore);

  it("updates active tab content", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("const x = 2;");

    const file = getActiveFile();
    expect(file?.content).toBe("const x = 2;");
    expect(file?.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("const x = 2;");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSplitPanelStore.getState().setContent("const x = 1;");
    expect(getActiveFile()?.isDirty).toBe(false);
  });
});

describe("markFileSaved", () => {
  beforeEach(resetStore);

  it("resets dirty and updates originalContent for specific file", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().updateFileContent("src/utils.ts", "modified");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSplitPanelStore.getState().markFileSaved("src/utils.ts");

    const file = getActiveFile();
    expect(file?.isDirty).toBe(false);
    expect(file?.originalContent).toBe("modified");
  });
});

describe("markSaved (operates on active tab)", () => {
  beforeEach(resetStore);

  it("resets dirty and updates originalContent to current content", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("modified");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSplitPanelStore.getState().markSaved();

    const file = getActiveFile();
    expect(file?.isDirty).toBe(false);
    expect(file?.originalContent).toBe("modified");
  });
});

describe("closePanel", () => {
  beforeEach(resetStore);

  it("sets isOpen to false while preserving file state", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().closePanel();

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeFilePath).toBe("src/utils.ts");
    expect(state.openFiles).toHaveLength(1);
  });
});

describe("clearFile", () => {
  beforeEach(resetStore);

  it("resets openFiles and activeFilePath", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("modified");
    useSplitPanelStore.getState().clearFile();

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe("togglePanel", () => {
  beforeEach(resetStore);

  it("flips isOpen on each call", () => {
    expect(useSplitPanelStore.getState().isOpen).toBe(false);
    useSplitPanelStore.getState().togglePanel();
    expect(useSplitPanelStore.getState().isOpen).toBe(true);
    useSplitPanelStore.getState().togglePanel();
    expect(useSplitPanelStore.getState().isOpen).toBe(false);
  });
});

describe("setError and clearError", () => {
  beforeEach(resetStore);

  it("setError sets error message and clears isLoading", () => {
    useSplitPanelStore.getState().setIsLoading(true);
    useSplitPanelStore.getState().setError("not found");

    const state = useSplitPanelStore.getState();
    expect(state.error).toBe("not found");
    expect(state.isLoading).toBe(false);
  });

  it("clearError removes the error message", () => {
    useSplitPanelStore.getState().setError("not found");
    useSplitPanelStore.getState().clearError();

    expect(useSplitPanelStore.getState().error).toBeNull();
  });
});

describe("toggleFilePicker", () => {
  beforeEach(resetStore);

  it("toggles isFilePickerOpen on each call", () => {
    expect(useSplitPanelStore.getState().isFilePickerOpen).toBe(false);
    useSplitPanelStore.getState().toggleFilePicker();
    expect(useSplitPanelStore.getState().isFilePickerOpen).toBe(true);
    useSplitPanelStore.getState().toggleFilePicker();
    expect(useSplitPanelStore.getState().isFilePickerOpen).toBe(false);
  });
});

describe("setIsLoading", () => {
  beforeEach(resetStore);

  it("sets isLoading to true and false", () => {
    useSplitPanelStore.getState().setIsLoading(true);
    expect(useSplitPanelStore.getState().isLoading).toBe(true);

    useSplitPanelStore.getState().setIsLoading(false);
    expect(useSplitPanelStore.getState().isLoading).toBe(false);
  });
});

describe("toggleExpandedPath", () => {
  beforeEach(resetStore);

  it("adds a path to expandedPaths", () => {
    useSplitPanelStore.getState().toggleExpandedPath("src");
    expect(useSplitPanelStore.getState().expandedPaths).toEqual(["src"]);
  });

  it("removes a path that is already expanded", () => {
    useSplitPanelStore.getState().toggleExpandedPath("src");
    useSplitPanelStore.getState().toggleExpandedPath("src");
    expect(useSplitPanelStore.getState().expandedPaths).toEqual([]);
  });

  it("handles multiple distinct paths", () => {
    useSplitPanelStore.getState().toggleExpandedPath("src");
    useSplitPanelStore.getState().toggleExpandedPath("lib");
    expect(useSplitPanelStore.getState().expandedPaths).toContain("src");
    expect(useSplitPanelStore.getState().expandedPaths).toContain("lib");
  });
});

describe("expandPathToFile", () => {
  beforeEach(resetStore);

  it("expands all parent directories of a file path", () => {
    useSplitPanelStore.getState().expandPathToFile("src/lib/utils.ts");
    const paths = useSplitPanelStore.getState().expandedPaths;
    expect(paths).toContain("src");
    expect(paths).toContain("src/lib");
    expect(paths).not.toContain("src/lib/utils.ts");
  });

  it("does not duplicate already-expanded paths", () => {
    useSplitPanelStore.getState().toggleExpandedPath("src");
    useSplitPanelStore.getState().expandPathToFile("src/lib/utils.ts");
    const paths = useSplitPanelStore.getState().expandedPaths;
    expect(paths.filter((p) => p === "src")).toHaveLength(1);
  });

  it("handles a file at root level (no parent dirs)", () => {
    useSplitPanelStore.getState().expandPathToFile("README.md");
    expect(useSplitPanelStore.getState().expandedPaths).toEqual([]);
  });
});

describe("persistence partialize", () => {
  beforeEach(resetStore);

  it("only persists isOpen, isFilePickerOpen, and expandedPaths", () => {
    useSplitPanelStore
      .getState()
      .openFileInTab("src/utils.ts", "const x = 1;", "typescript");

    const partialize = useSplitPanelStore.persist.getOptions().partialize!;
    const persisted = partialize(useSplitPanelStore.getState());

    expect(persisted).toHaveProperty("isOpen");
    expect(persisted).toHaveProperty("isFilePickerOpen");
    expect(persisted).toHaveProperty("expandedPaths");

    expect(persisted).not.toHaveProperty("openFilePaths");
    expect(persisted).not.toHaveProperty("activeFilePath");
    expect(persisted).not.toHaveProperty("openFiles");
    expect(persisted).not.toHaveProperty("isLoading");
    expect(persisted).not.toHaveProperty("error");
  });
});
