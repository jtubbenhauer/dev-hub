import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  countTreeFiles,
  flattenVisibleItems,
  type FileTreeFolder,
} from "@/lib/git-file-tree";

type SortMode = "name-asc" | "name-desc" | "status" | "path";

interface TestFile {
  path: string;
  label: string;
}

function folderOrderForMode(mode: SortMode): "asc" | "desc" {
  return mode === "name-desc" ? "desc" : "asc";
}

function file(path: string, label = path): TestFile {
  return { path, label };
}

function folderNames<T>(folder: FileTreeFolder<T>): string[] {
  return folder.folders.map((child) => child.name);
}

function findFolder<T>(
  folder: FileTreeFolder<T>,
  name: string,
): FileTreeFolder<T> {
  const child = folder.folders.find((candidate) => candidate.name === name);
  if (!child) throw new Error(`folder ${name} not found`);
  return child;
}

describe("buildFileTree", () => {
  it("builds a nested tree from mixed-depth paths", () => {
    const root = buildFileTree([
      file("components/git/pr-file-list.tsx"),
      file("components/git/changed-file-list.tsx"),
      file("lib/git-panel-logic.ts"),
    ]);

    expect(folderNames(root)).toEqual(["components", "lib"]);
    const components = findFolder(root, "components");
    expect(components.path).toBe("components");
    const git = findFolder(components, "git");
    expect(git.path).toBe("components/git");
    expect(git.files.map((f) => f.path)).toEqual([
      "components/git/pr-file-list.tsx",
      "components/git/changed-file-list.tsx",
    ]);
    const lib = findFolder(root, "lib");
    expect(lib.files.map((f) => f.path)).toEqual(["lib/git-panel-logic.ts"]);
  });

  it("places root-level files (no folder) in root.files", () => {
    const root = buildFileTree([
      file("README.md"),
      file("package.json"),
      file("lib/db.ts"),
    ]);

    expect(root.name).toBe("");
    expect(root.path).toBe("");
    expect(root.files.map((f) => f.path)).toEqual([
      "README.md",
      "package.json",
    ]);
    expect(folderNames(root)).toEqual(["lib"]);
  });

  it("returns an empty root for empty input", () => {
    const root = buildFileTree<TestFile>([]);
    expect(root).toEqual({ name: "", path: "", folders: [], files: [] });
    expect(countTreeFiles(root)).toBe(0);
    expect(flattenVisibleItems(root, new Set())).toEqual([]);
  });

  it("orders child folders ascending by name", () => {
    const root = buildFileTree([
      file("zeta/a.ts"),
      file("alpha/b.ts"),
      file("mid/c.ts"),
    ]);
    expect(folderNames(root)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("reverses folder ordering at every depth when folderOrder is desc", () => {
    const root = buildFileTree(
      [file("alpha/x/one.ts"), file("alpha/y/two.ts"), file("beta/z/three.ts")],
      "desc",
    );
    expect(folderNames(root)).toEqual(["beta", "alpha"]);
    const alpha = findFolder(root, "alpha");
    expect(folderNames(alpha)).toEqual(["y", "x"]);
  });

  it("preserves caller-provided file order across folders (stable insertion order)", () => {
    const root = buildFileTree([
      file("src/z-last.ts"),
      file("src/a-first.ts"),
      file("src/m-middle.ts"),
    ]);
    const src = findFolder(root, "src");
    expect(src.files.map((f) => f.path)).toEqual([
      "src/z-last.ts",
      "src/a-first.ts",
      "src/m-middle.ts",
    ]);
  });

  it("keeps same-folder insertion order stable for files pushed into one folder", () => {
    const root = buildFileTree([
      file("dir/second.ts", "second"),
      file("dir/first.ts", "first"),
    ]);
    const dir = findFolder(root, "dir");
    expect(dir.files.map((f) => f.label)).toEqual(["second", "first"]);
  });

  it("merges duplicate-path folders into a single node", () => {
    const root = buildFileTree([
      file("components/git/a.tsx"),
      file("components/git/b.tsx"),
    ]);
    expect(root.folders).toHaveLength(1);
    const components = findFolder(root, "components");
    expect(components.folders).toHaveLength(1);
    const git = findFolder(components, "git");
    expect(git.files).toHaveLength(2);
  });
});

describe("countTreeFiles", () => {
  it("counts all descendant files recursively", () => {
    const root = buildFileTree([
      file("a/b/c/deep.ts"),
      file("a/b/mid.ts"),
      file("a/shallow.ts"),
      file("root.ts"),
    ]);
    expect(countTreeFiles(root)).toBe(4);
    const a = findFolder(root, "a");
    expect(countTreeFiles(a)).toBe(3);
    const b = findFolder(a, "b");
    expect(countTreeFiles(b)).toBe(2);
  });
});

describe("flattenVisibleItems", () => {
  it("emits subfolders first then files in render order", () => {
    const root = buildFileTree([
      file("root-file.ts"),
      file("alpha/a.ts"),
      file("beta/b.ts"),
    ]);
    expect(flattenVisibleItems(root, new Set()).map((f) => f.path)).toEqual([
      "alpha/a.ts",
      "beta/b.ts",
      "root-file.ts",
    ]);
  });

  it("skips a collapsed folder and all its nested descendants", () => {
    const root = buildFileTree([
      file("alpha/nested/deep.ts"),
      file("alpha/top.ts"),
      file("beta/b.ts"),
    ]);
    const visible = flattenVisibleItems(root, new Set(["alpha"]));
    expect(visible.map((f) => f.path)).toEqual(["beta/b.ts"]);
  });

  it("collapsing an inner folder hides only its descendants", () => {
    const root = buildFileTree([
      file("alpha/nested/deep.ts"),
      file("alpha/top.ts"),
    ]);
    const visible = flattenVisibleItems(root, new Set(["alpha/nested"]));
    expect(visible.map((f) => f.path)).toEqual(["alpha/top.ts"]);
  });

  const sortModes: SortMode[] = ["name-asc", "name-desc", "status", "path"];
  it.each(sortModes)(
    "flatten order equals render order for sort mode %s",
    (mode) => {
      const items = [
        file("beta/y.ts"),
        file("alpha/x.ts"),
        file("alpha/sub/z.ts"),
        file("root.ts"),
      ];
      const order = folderOrderForMode(mode);
      const root = buildFileTree(items, order);

      const expected: string[] = [];
      const walk = (folder: FileTreeFolder<TestFile>): void => {
        for (const child of folder.folders) walk(child);
        for (const f of folder.files) expected.push(f.path);
      };
      walk(root);

      expect(flattenVisibleItems(root, new Set()).map((f) => f.path)).toEqual(
        expected,
      );
    },
  );
});
