// @vitest-environment node
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaseResolver } from "@/lib/lsp/case-resolver";
import { workspaceRelativePathToFileUri } from "@/lib/lsp/document-scope";

describe("createCaseResolver", () => {
  let sandbox: string;
  let root: string;
  beforeEach(() => {
    sandbox = fs.mkdtempSync(join(tmpdir(), "lsp-case-"));
    root = join(sandbox, "Workspace");
    fs.mkdirSync(join(root, "src/Components"), { recursive: true });
    for (const file of [
      "src/Components/Widget.ts",
      "src/my file.ts",
      "src/100%.ts",
    ]) {
      fs.writeFileSync(join(root, file), "");
    }
  });
  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  it.each([
    ["src/components/widget.ts", "src/Components/Widget.ts"],
    ["src/my file.ts", "src/my file.ts"],
    ["src/100%.ts", "src/100%.ts"],
  ])("restores %s when given a lowercased encoded URI", (input, expected) => {
    const resolver = createCaseResolver(root);
    const result = resolver.resolveRealCaseUri(
      workspaceRelativePathToFileUri(root, input).toLowerCase(),
    );
    expect(result).toBe(workspaceRelativePathToFileUri(root, expected));
  });

  it.each(["missing.ts", "../Workspace2/a.ts", "%2F..%2Fa.ts", "/a.ts", ""])(
    "returns null when the relative path is invalid or missing: %s",
    (path) => {
      const resolver = createCaseResolver(root);
      const result = resolver.resolveRealCaseUri(`file://${root}/${path}`);
      expect(result).toBeNull();
    },
  );
  it.each(["inmemory://model/3", "file:///bad/%zz.ts", "not a URI"])(
    "returns null when the URI is unsupported: %s",
    (uri) => {
      const resolver = createCaseResolver(root);
      expect(resolver.resolveRealCaseUri(uri)).toBeNull();
    },
  );

  it("returns null when a symlink escapes the real workspace", () => {
    fs.writeFileSync(join(sandbox, "outside.ts"), "");
    fs.symlinkSync(sandbox, join(root, "escape"));
    const resolver = createCaseResolver(root);
    const result = resolver.resolveRealCaseUri(
      workspaceRelativePathToFileUri(root, "escape/outside.ts"),
    );
    expect(result).toBeNull();
  });

  it("keeps the workspace URI when an internal symlink resolves inside", () => {
    fs.symlinkSync(join(root, "src"), join(root, "link"));
    const resolver = createCaseResolver(root);
    const result = resolver.resolveRealCaseUri(
      workspaceRelativePathToFileUri(root, "link/components/widget.ts"),
    );
    expect(result).toBe(
      workspaceRelativePathToFileUri(root, "link/Components/Widget.ts"),
    );
  });

  it("checks containment again when a memoized symlink changes target", () => {
    fs.symlinkSync(join(root, "src"), join(root, "link"));
    const resolver = createCaseResolver(root);
    const uri = workspaceRelativePathToFileUri(root, "link/my file.ts");
    resolver.resolveRealCaseUri(uri);
    fs.unlinkSync(join(root, "link"));
    fs.writeFileSync(join(sandbox, "my file.ts"), "");
    fs.symlinkSync(sandbox, join(root, "link"));
    expect(resolver.resolveRealCaseUri(uri)).toBeNull();
  });

  it("re-lists once on a cached-directory miss when a new file appears", () => {
    const readdirSync = vi.fn((path: string) => fs.readdirSync(path));
    const resolver = createCaseResolver(root, {
      readdirSync,
      realpathSync: fs.realpathSync.native,
    });
    resolver.resolveRealCaseUri(
      workspaceRelativePathToFileUri(root, "src/my file.ts"),
    );
    fs.writeFileSync(join(root, "src/New.ts"), "");
    readdirSync.mockClear();
    const result = resolver.resolveRealCaseUri(
      workspaceRelativePathToFileUri(root, "src/new.ts"),
    );
    expect(result).toBe(workspaceRelativePathToFileUri(root, "src/New.ts"));
    expect(readdirSync.mock.calls).toEqual([[join(root, "src")]]);
  });

  it("retries exactly once when a fresh directory listing misses", () => {
    const readdirSync = vi.fn(() => []);
    const resolver = createCaseResolver(root, {
      readdirSync,
      realpathSync: fs.realpathSync.native,
    });
    expect(
      resolver.resolveRealCaseUri(
        workspaceRelativePathToFileUri(root, "missing.ts"),
      ),
    ).toBeNull();
    expect(readdirSync).toHaveBeenCalledTimes(2);
  });

  it("memoizes resolved paths and computes the real root once", () => {
    const readdirSync = vi.fn((path: string) => fs.readdirSync(path));
    const realpathSync = vi.fn((path: string) => fs.realpathSync.native(path));
    const resolver = createCaseResolver(root, { readdirSync, realpathSync });
    const uri = workspaceRelativePathToFileUri(
      root,
      "src/components/widget.ts",
    );
    resolver.resolveRealCaseUri(uri);
    readdirSync.mockClear();
    expect(resolver.resolveRealCaseUri(uri)).toBe(
      workspaceRelativePathToFileUri(root, "src/Components/Widget.ts"),
    );
    expect(readdirSync).not.toHaveBeenCalled();
    expect(
      realpathSync.mock.calls.filter(([path]) => path === root),
    ).toHaveLength(1);
  });

  it.each(["readdir", "root-realpath", "file-realpath"])(
    "returns null when %s throws",
    (failure) => {
      const resolver = createCaseResolver(root, {
        readdirSync: (path) => {
          if (failure === "readdir") throw new Error("unreadable");
          return fs.readdirSync(path);
        },
        realpathSync: (path) => {
          if ((path === root) === (failure === "root-realpath"))
            throw new Error("unresolvable");
          return fs.realpathSync.native(path);
        },
      });
      expect(
        resolver.resolveRealCaseUri(
          workspaceRelativePathToFileUri(root, "src/my file.ts"),
        ),
      ).toBeNull();
    },
  );

  it.each(["Widget.ts", "WIDGET.TS"])(
    "prefers exact names then locale-sorted matches when resolving %s",
    (name) => {
      const names = ["widget.ts", "Widget.ts"];
      const resolver = createCaseResolver("/ws", {
        readdirSync: () => names,
        realpathSync: (path) => path,
      });
      const expected = names.includes(name)
        ? name
        : [...names].sort((a, b) => a.localeCompare(b))[0];
      expect(resolver.resolveRealCaseUri(`file:///ws/${name}`)).toBe(
        `file:///ws/${expected}`,
      );
    },
  );

  it("clears the relative-path memo when 5,000 entries are full", () => {
    const names = Array.from({ length: 5001 }, (_, index) => `FILE${index}.ts`);
    const resolver = createCaseResolver("/ws", {
      readdirSync: () => names,
      realpathSync: (path) => path,
    });
    for (let index = 0; index < 5001; index += 1)
      resolver.resolveRealCaseUri(`file:///ws/file${index}.ts`);
    names[0] = "file0.ts";
    expect(resolver.resolveRealCaseUri("file:///ws/file0.ts")).toBe(
      "file:///ws/file0.ts",
    );
  });
});
