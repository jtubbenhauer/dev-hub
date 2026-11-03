import { describe, expect, it } from "vitest";
import { migratePersistedEditorState } from "@/lib/files/persisted-editor-state";

describe("migratePersistedEditorState", () => {
  it("keeps only the diff view mode and the expanded folders of a saved state", () => {
    // When
    const migrated = migratePersistedEditorState({
      isFileTreeOpen: false,
      diffViewMode: "side-by-side",
      workspaceFileStates: {
        "ws-A": {
          tabs: [{ path: "src/a.ts", name: "a.ts", language: "typescript" }],
          activeFilePath: "src/a.ts",
          expandedPaths: ["src", "src/lib"],
        },
      },
    });

    // Then
    expect(migrated).toEqual({
      diffViewMode: "side-by-side",
      workspaceFileStates: { "ws-A": { expandedPaths: ["src", "src/lib"] } },
    });
  });

  it("drops workspace states without expanded folders and paths that are not strings", () => {
    // When
    const migrated = migratePersistedEditorState({
      diffViewMode: "unified",
      workspaceFileStates: {
        "ws-A": { expandedPaths: ["src", 7, null] },
        "ws-B": "not a workspace state",
        "ws-C": { tabs: [], activeFilePath: null },
        "ws-D": { expandedPaths: "src" },
      },
    });

    // Then
    expect(migrated.workspaceFileStates).toEqual({
      "ws-A": { expandedPaths: ["src"] },
    });
  });

  it("falls back to the unified diff view for an unknown mode", () => {
    // When
    const migrated = migratePersistedEditorState({ diffViewMode: "sideways" });

    // Then
    expect(migrated.diffViewMode).toBe("unified");
  });

  it.each([null, "garbage", ["src"], 7])(
    "starts from the defaults when the saved state is %j",
    (saved) => {
      // When
      const migrated = migratePersistedEditorState(saved);

      // Then
      expect(migrated).toEqual({
        diffViewMode: "unified",
        workspaceFileStates: {},
      });
    },
  );
});
