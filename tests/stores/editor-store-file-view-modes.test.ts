import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "@/stores/editor-store";
import type { OpenFile } from "@/types";

function buffer(path: string): OpenFile {
  return {
    workspaceId: "ws1",
    path,
    name: path,
    content: "text",
    originalContent: "text",
    language: "typescript",
    isDirty: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    fileViewModes: {},
  });
});

describe("editor-store file view modes", () => {
  it("starts without any stored view mode", () => {
    // When
    const { fileViewModes } = useEditorStore.getInitialState();

    // Then
    expect(fileViewModes).toEqual({});
  });

  it("stores a mode under its workspace-qualified key", () => {
    // When
    useEditorStore.getState().setFileViewMode("ws1:src/a.ts", "diff");

    // Then
    expect(useEditorStore.getState().fileViewModes).toEqual({
      "ws1:src/a.ts": "diff",
    });
  });

  it("keeps the same path independent across workspaces", () => {
    // Given
    useEditorStore.getState().setFileViewMode("ws2:src/a.ts", "diff");

    // When
    useEditorStore.getState().setFileViewMode("ws1:src/a.ts", "editor");

    // Then
    expect(useEditorStore.getState().fileViewModes).toEqual({
      "ws1:src/a.ts": "editor",
      "ws2:src/a.ts": "diff",
    });
  });

  it("never persists view modes", () => {
    // Given
    useEditorStore.getState().setFileViewMode("ws1:src/a.ts", "diff");

    // When
    const persisted = useEditorStore.persist
      .getOptions()
      .partialize?.(useEditorStore.getState());

    // Then
    expect(persisted).not.toHaveProperty("fileViewModes");
  });

  it("drops the view modes of a file whose buffer closes", () => {
    // Given
    useEditorStore.setState({
      openFiles: [buffer("src/a.ts"), buffer("src/b.ts")],
    });
    useEditorStore.getState().setFileViewMode("ws1:src/a.ts", "diff");
    useEditorStore.getState().setFileViewMode("ws2:src/a.ts", "diff");
    useEditorStore.getState().setFileViewMode("ws1:src/b.ts", "diff");

    // When
    useEditorStore.getState().closeFile("src/a.ts");

    // Then
    expect(useEditorStore.getState().fileViewModes).toEqual({
      "ws1:src/b.ts": "diff",
    });
  });
});
