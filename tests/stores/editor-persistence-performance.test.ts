import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/stores/editor-store";

afterEach(() => vi.restoreAllMocks());

describe("editor persistence hot path", () => {
  it("does not serialize or write content edits", () => {
    useEditorStore.setState({
      openFiles: [
        {
          path: "a.ts",
          name: "a.ts",
          language: "typescript",
          content: "base",
          originalContent: "base",
          isDirty: false,
        },
      ],
      activeFilePath: "a.ts",
    });
    const stringify = vi.spyOn(JSON, "stringify");
    const write = vi.spyOn(Storage.prototype, "setItem");
    useEditorStore.getState().updateFileContent("a.ts", "changed");
    expect(stringify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("does not serialize or write when a file buffer opens", () => {
    useEditorStore.setState({ openFiles: [], activeFilePath: null });
    const stringify = vi.spyOn(JSON, "stringify");
    const write = vi.spyOn(Storage.prototype, "setItem");
    useEditorStore.getState().openFile({
      workspaceId: "ws",
      path: "b.ts",
      name: "b.ts",
      language: "typescript",
      content: "base",
      originalContent: "base",
      isDirty: false,
    });
    expect(stringify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
