import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/stores/editor-store";
import { useSidePanelStore } from "@/stores/side-panel-store";

afterEach(() => vi.restoreAllMocks());

describe("editor persistence hot path", () => {
  it.each(["files", "split"])(
    "does not serialize or write content edits in %s",
    (surface) => {
      const store = surface === "files" ? useEditorStore : useSidePanelStore;
      const state = {
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
      };
      if (surface === "files") useEditorStore.setState(state);
      else useSidePanelStore.setState(state);
      const stringify = vi.spyOn(JSON, "stringify");
      const write = vi.spyOn(Storage.prototype, "setItem");
      store.getState().updateFileContent("a.ts", "changed");
      expect(stringify).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );

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
