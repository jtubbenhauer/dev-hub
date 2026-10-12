// @vitest-environment node
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileContentIfUnchanged } from "@/lib/files/operations";
import { workspaceRelativePathToFileUri } from "@/lib/lsp/document-scope";
import { applyWorkspaceEditToDisk } from "@/lib/lsp/workspace-edit-writer";
import { useEditorStore } from "@/stores/editor-store";

const base = "export const x = 1;\n";
const edited = "export const x = 2;\n";
const saved = "export const x = 3;\n";
let workspaceRoot: string;

function applyEdit() {
  const uri = workspaceRelativePathToFileUri(workspaceRoot, "x.ts");
  return applyWorkspaceEditToDisk({
    workspaceRoot,
    syncedDocuments: new Map([[uri, { version: 1, text: base }]]),
    dirtyUris: new Set(),
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 1, character: 0 },
            },
            newText: edited,
          },
        ],
      },
    },
  });
}

beforeEach(() => {
  workspaceRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "devhub-edit-interleaving-")),
  );
  writeFileSync(join(workspaceRoot, "x.ts"), base);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});
afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("workspace edit and save ordering", () => {
  it("refuses a workspace edit when a save landed after didOpen", () => {
    expect(
      writeFileContentIfUnchanged(workspaceRoot, "x.ts", saved, base),
    ).toBe("written");

    const result = applyEdit();

    expect(result.applied).toBe(false);
    expect(result.reason).toContain("x.ts has unsaved changes");
    expect(result.changedUris).toEqual([]);
    expect(readFileSync(join(workspaceRoot, "x.ts"), "utf8")).toBe(saved);
  });
  it("refuses a stale save when a workspace edit landed first", () => {
    expect(applyEdit().applied).toBe(true);

    const result = writeFileContentIfUnchanged(
      workspaceRoot,
      "x.ts",
      saved,
      base,
    );

    expect(result).toBe("stale");
    expect(readFileSync(join(workspaceRoot, "x.ts"), "utf8")).toBe(edited);
  });
  it("allows a normal save when reload advanced the store base", () => {
    useEditorStore.getState().openFile({
      path: "x.ts",
      name: "x.ts",
      workspaceId: "A",
      language: "typescript",
      content: base,
      originalContent: base,
      isDirty: false,
    });
    expect(applyEdit().applied).toBe(true);
    useEditorStore
      .getState()
      .replaceFileContentFromDisk(
        "A",
        "x.ts",
        readFileSync(join(workspaceRoot, "x.ts"), "utf8"),
      );
    useEditorStore.getState().updateFileContent("x.ts", saved);
    const file = useEditorStore.getState().openFiles[0];

    const result = writeFileContentIfUnchanged(
      workspaceRoot,
      file.path,
      file.content,
      file.originalContent,
    );

    expect(result).toBe("written");
    expect(readFileSync(join(workspaceRoot, "x.ts"), "utf8")).toBe(saved);
  });
});
