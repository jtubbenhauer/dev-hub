import { describe, it, expect, beforeEach } from "vitest";
import { useSplitPanelStore } from "@/stores/split-panel-store";

const initialState = {
  isOpen: false,
  activeTab: "files" as const,
  currentFilePath: null,
  currentFileContent: null,
  currentFileLanguage: null,
  originalContent: null,
  isDirty: false,
  isFilePickerOpen: false,
  isLoading: false,
  error: null,
  expandedPaths: [] as string[],
};

function resetStore() {
  useSplitPanelStore.setState(initialState);
}

describe("default state", () => {
  beforeEach(resetStore);

  it("has correct default values", () => {
    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.currentFilePath).toBeNull();
    expect(state.currentFileContent).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.activeTab).toBe("files");
    expect(state.isFilePickerOpen).toBe(false);
    expect(state.originalContent).toBeNull();
    expect(state.currentFileLanguage).toBeNull();
  });
});

describe("openFile", () => {
  beforeEach(resetStore);

  it("sets state and opens panel", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.currentFilePath).toBe("src/utils.ts");
    expect(state.currentFileContent).toBe("const x = 1;");
    expect(state.originalContent).toBe("const x = 1;");
    expect(state.isDirty).toBe(false);
    expect(state.currentFileLanguage).toBe("typescript");
    expect(state.error).toBeNull();
  });
});

describe("setContent", () => {
  beforeEach(resetStore);

  it("updates content and marks dirty when different from original", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("const x = 2;");

    const state = useSplitPanelStore.getState();
    expect(state.currentFileContent).toBe("const x = 2;");
    expect(state.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("const x = 2;");
    expect(useSplitPanelStore.getState().isDirty).toBe(true);

    useSplitPanelStore.getState().setContent("const x = 1;");
    expect(useSplitPanelStore.getState().isDirty).toBe(false);
  });
});

describe("markSaved", () => {
  beforeEach(resetStore);

  it("resets dirty and updates originalContent to current content", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("modified");
    expect(useSplitPanelStore.getState().isDirty).toBe(true);

    useSplitPanelStore.getState().markSaved();

    const state = useSplitPanelStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.originalContent).toBe("modified");
  });
});

describe("closePanel", () => {
  beforeEach(resetStore);

  it("sets isOpen to false while preserving file state", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().closePanel();

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.currentFilePath).toBe("src/utils.ts");
    expect(state.currentFileContent).toBe("const x = 1;");
  });
});

describe("clearFile", () => {
  beforeEach(resetStore);

  it("resets all file-related fields", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");
    useSplitPanelStore.getState().setContent("modified");
    useSplitPanelStore.getState().clearFile();

    const state = useSplitPanelStore.getState();
    expect(state.currentFilePath).toBeNull();
    expect(state.currentFileContent).toBeNull();
    expect(state.currentFileLanguage).toBeNull();
    expect(state.originalContent).toBeNull();
    expect(state.isDirty).toBe(false);
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

  it("only persists isOpen, currentFilePath, isFilePickerOpen, and expandedPaths", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/utils.ts", "const x = 1;", "typescript");

    const partialize = useSplitPanelStore.persist.getOptions().partialize!;
    const persisted = partialize(useSplitPanelStore.getState());

    expect(persisted).toHaveProperty("isOpen");
    expect(persisted).toHaveProperty("currentFilePath");
    expect(persisted).toHaveProperty("isFilePickerOpen");
    expect(persisted).toHaveProperty("expandedPaths");

    expect(persisted).not.toHaveProperty("currentFileContent");
    expect(persisted).not.toHaveProperty("originalContent");
    expect(persisted).not.toHaveProperty("isDirty");
    expect(persisted).not.toHaveProperty("currentFileLanguage");
    expect(persisted).not.toHaveProperty("isLoading");
    expect(persisted).not.toHaveProperty("error");
  });
});
