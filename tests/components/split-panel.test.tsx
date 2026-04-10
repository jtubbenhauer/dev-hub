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

describe("split panel store — default state", () => {
  beforeEach(resetStore);

  it("has correct default values on first load", () => {
    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.isFilePickerOpen).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.activeTab).toBe("files");
  });
});

describe("split panel store — openFile", () => {
  beforeEach(resetStore);

  it("opens the panel and sets file as active tab", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeFilePath).toBe("src/foo.ts");
    expect(state.openFiles).toHaveLength(1);
    expect(state.openFiles[0].content).toBe("const x = 1");
    expect(state.openFiles[0].language).toBe("typescript");
  });

  it("sets originalContent equal to the content passed in", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");

    const file = getActiveFile();
    expect(file?.originalContent).toBe("const x = 1");
    expect(file?.isDirty).toBe(false);
  });

  it("clears error when opening a new file", () => {
    useSplitPanelStore.getState().setError("previous error");
    useSplitPanelStore
      .getState()
      .openFile("src/bar.ts", "export {}", "typescript");

    expect(useSplitPanelStore.getState().error).toBeNull();
  });
});

describe("split panel store — closePanel", () => {
  beforeEach(resetStore);

  it("sets isOpen to false but preserves tabs", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().closePanel();

    const state = useSplitPanelStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeFilePath).toBe("src/foo.ts");
  });

  it("preserves tab content after close", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().closePanel();

    const file = getActiveFile();
    expect(file?.content).toBe("const x = 1");
  });
});

describe("split panel store — isDirty tracking", () => {
  beforeEach(resetStore);

  it("becomes dirty when content differs from originalContent", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().setContent("changed");

    expect(getActiveFile()?.isDirty).toBe(true);
  });

  it("clears dirty when content reverts to original", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().setContent("changed");
    useSplitPanelStore.getState().setContent("const x = 1");

    expect(getActiveFile()?.isDirty).toBe(false);
  });
});

describe("split panel store — error states", () => {
  beforeEach(resetStore);

  it("setError stores the error message and clears isLoading", () => {
    useSplitPanelStore.getState().setIsLoading(true);
    useSplitPanelStore.getState().setError("BINARY:foo.png");

    const state = useSplitPanelStore.getState();
    expect(state.error).toBe("BINARY:foo.png");
    expect(state.isLoading).toBe(false);
  });

  it("clearError resets error to null", () => {
    useSplitPanelStore.getState().setError("BINARY:foo.png");
    useSplitPanelStore.getState().clearError();

    expect(useSplitPanelStore.getState().error).toBeNull();
  });
});

describe("split panel store — togglePanel", () => {
  beforeEach(resetStore);

  it("toggles isOpen from false to true", () => {
    expect(useSplitPanelStore.getState().isOpen).toBe(false);
    useSplitPanelStore.getState().togglePanel();
    expect(useSplitPanelStore.getState().isOpen).toBe(true);
  });

  it("toggles isOpen back to false on second call", () => {
    useSplitPanelStore.getState().togglePanel();
    useSplitPanelStore.getState().togglePanel();
    expect(useSplitPanelStore.getState().isOpen).toBe(false);
  });
});

describe("split panel store — clearFile", () => {
  beforeEach(resetStore);

  it("resets openFiles and activeFilePath", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().clearFile();

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
  });

  it("resets error", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().setContent("changed");
    useSplitPanelStore.getState().setError("oops");
    useSplitPanelStore.getState().clearFile();

    const state = useSplitPanelStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.activeFilePath).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe("split panel store — markSaved", () => {
  beforeEach(resetStore);

  it("clears isDirty and updates originalContent to current content", () => {
    useSplitPanelStore
      .getState()
      .openFile("src/foo.ts", "const x = 1", "typescript");
    useSplitPanelStore.getState().setContent("const x = 99");
    expect(getActiveFile()?.isDirty).toBe(true);

    useSplitPanelStore.getState().markSaved();

    const file = getActiveFile();
    expect(file?.isDirty).toBe(false);
    expect(file?.originalContent).toBe("const x = 99");
    expect(file?.content).toBe("const x = 99");
  });
});

describe("split panel store — setIsLoading", () => {
  beforeEach(resetStore);

  it("sets isLoading to true then false", () => {
    useSplitPanelStore.getState().setIsLoading(true);
    expect(useSplitPanelStore.getState().isLoading).toBe(true);

    useSplitPanelStore.getState().setIsLoading(false);
    expect(useSplitPanelStore.getState().isLoading).toBe(false);
  });
});
