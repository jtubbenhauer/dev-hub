import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/stores/editor-store";

const EDITOR_STORAGE_KEY = "dev-hub-editor";

// The shape the store saved before file tabs moved into the workbench layout.
const savedBeforeWorkbench = {
  state: {
    isFileTreeOpen: false,
    diffViewMode: "side-by-side",
    workspaceFileStates: {
      "ws-A": {
        tabs: [{ path: "src/a.ts", name: "a.ts", language: "typescript" }],
        activeFilePath: "src/a.ts",
        expandedPaths: ["src", "src/lib"],
      },
    },
  },
  version: 0,
};

async function rehydrateFrom(savedValue: unknown) {
  localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(savedValue));
  await useEditorStore.persist.rehydrate();
}

function readSavedValue(): unknown {
  return JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? "null");
}

function readPersistedFields() {
  const { diffViewMode, workspaceFileStates } = useEditorStore.getState();
  return { diffViewMode, workspaceFileStates };
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  localStorage.clear();
});

describe("editor store persistence", () => {
  it("keeps only the diff view mode and expanded folders of a value saved before the workbench", async () => {
    // When
    await rehydrateFrom(savedBeforeWorkbench);

    // Then
    expect(readPersistedFields()).toEqual({
      diffViewMode: "side-by-side",
      workspaceFileStates: { "ws-A": { expandedPaths: ["src", "src/lib"] } },
    });
  });

  it("rewrites a value saved before the workbench in the current format", async () => {
    // When
    await rehydrateFrom(savedBeforeWorkbench);

    // Then
    expect(readSavedValue()).toEqual({
      state: {
        diffViewMode: "side-by-side",
        workspaceFileStates: { "ws-A": { expandedPaths: ["src", "src/lib"] } },
      },
      version: 1,
    });
  });

  it("saves only the diff view mode and the expanded folders", () => {
    // Given
    useEditorStore.setState({
      diffViewMode: "side-by-side",
      openFiles: [
        {
          workspaceId: "ws-A",
          path: "src/a.ts",
          name: "a.ts",
          content: "export const a = 1;\n",
          originalContent: "export const a = 1;\n",
          language: "typescript",
          isDirty: false,
        },
      ],
      activeFilePath: "src/a.ts",
    });

    // When
    useEditorStore.getState().toggleExpandedPath("ws-A", "src");

    // Then
    expect(readSavedValue()).toEqual({
      state: {
        diffViewMode: "side-by-side",
        workspaceFileStates: { "ws-A": { expandedPaths: ["src"] } },
      },
      version: 1,
    });
  });
});
