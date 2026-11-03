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

  it("keeps the metadata-only persisted format on tab saves", () => {
    useEditorStore.setState({
      openFiles: [
        {
          path: "a.ts",
          name: "a.ts",
          language: "typescript",
          content: "unsaved",
          originalContent: "base",
          isDirty: true,
        },
      ],
      activeFilePath: "a.ts",
    });
    useEditorStore.getState().saveWorkspaceState("ws");
    const saved = JSON.parse(localStorage.getItem("dev-hub-editor") ?? "{}");
    expect(saved.state.workspaceFileStates.ws.tabs).toEqual([
      { path: "a.ts", name: "a.ts", language: "typescript" },
    ]);
    expect(saved.state.workspaceFileStates.ws.activeFilePath).toBe("a.ts");
  });
});
