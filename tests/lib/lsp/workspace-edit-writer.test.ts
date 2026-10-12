// @vitest-environment node
// allow: SIZE_OK — Task 4 requires the disk transaction and rollback cases in this single suite.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceRelativePathToFileUri } from "@/lib/lsp/document-scope";
import {
  applyWorkspaceEditToDisk,
  type WriterFs,
} from "@/lib/lsp/workspace-edit-writer";
import type { LspSyncedDocument, LspWorkspaceEdit } from "@/lib/lsp/types";

let root: string;
const synced = new Map<string, LspSyncedDocument>();
const dirty = new Set<string>();
const uri = (path: string) => workspaceRelativePathToFileUri(root, path);
const edits = [
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    newText: "X",
  },
];
const diskFs: WriterFs = { ...fs, realpathSync: fs.realpathSync.native };
const apply = (edit: LspWorkspaceEdit, fsImpl = diskFs) =>
  applyWorkspaceEditToDisk({
    workspaceRoot: root,
    edit,
    syncedDocuments: synced,
    dirtyUris: dirty,
    fsImpl,
  });
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "lsp-writer-")));
  fs.mkdirSync(join(root, "src"));
  fs.writeFileSync(join(root, "a.ts"), "abc\r\n");
  fs.writeFileSync(join(root, "b.ts"), "bcd");
  synced.clear();
  dirty.clear();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("workspace writer", () => {
  it("writes multiple files synchronously when all operations pass preflight", () => {
    const result = apply({
      changes: { [uri("a.ts")]: edits, [uri("b.ts")]: edits },
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual({
      applied: true,
      reason: null,
      changedUris: [uri("a.ts"), uri("b.ts")],
      createdUris: [],
    });
    expect(fs.readFileSync(join(root, "a.ts"), "utf8")).toBe("Xbc\r\n");
    expect(fs.readFileSync(join(root, "b.ts"), "utf8")).toBe("Xcd");
  });
  it.each(["src/new.ts", "new.ts"])(
    "creates %s when the parent exists",
    (path) => {
      const result = apply({
        documentChanges: [
          { kind: "create", uri: uri(path) },
          { textDocument: { uri: uri(path), version: null }, edits },
        ],
      });
      expect(result).toEqual({
        applied: true,
        reason: null,
        changedUris: [uri(path)],
        createdUris: [uri(path)],
      });
      expect(fs.readFileSync(join(root, path), "utf8")).toBe("X");
    },
  );
  it("applies versioned edits when synced text equals disk", () => {
    synced.set(uri("a.ts"), { version: 3, text: "abc\r\n" });
    const result = apply({
      documentChanges: [
        { textDocument: { uri: uri("a.ts"), version: 3 }, edits },
      ],
    });
    expect(result.applied).toBe(true);
  });
  it("drops unchanged entries when no text changes", () => {
    const result = apply({ changes: { [uri("a.ts")]: [] } });
    expect(result.changedUris).toEqual([]);
  });
  it("honors documentChanges over changes when both exist", () => {
    const result = apply({
      changes: { [uri("missing.ts")]: edits },
      documentChanges: [],
    });
    expect(result.applied).toBe(true);
  });
  it("keeps existing content when creation ignores existing files", () => {
    const result = apply({
      documentChanges: [
        { kind: "create", uri: uri("a.ts"), options: { ignoreIfExists: true } },
      ],
    });
    expect(result.changedUris).toEqual([]);
    expect(fs.readFileSync(join(root, "a.ts"), "utf8")).toBe("abc\r\n");
  });
  it("overwrites existing content when overwrite takes precedence", () => {
    const result = apply({
      documentChanges: [
        {
          kind: "create",
          uri: uri("a.ts"),
          options: { overwrite: true, ignoreIfExists: true },
        },
      ],
    });
    expect(result.createdUris).toEqual([]);
    expect(fs.readFileSync(join(root, "a.ts"), "utf8")).toBe("");
  });
});

describe("refuse", () => {
  it("refuses versioned edits when the document is not synced", () => {
    const result = apply({
      documentChanges: [
        { textDocument: { uri: uri("a.ts"), version: 1 }, edits },
      ],
    });
    expect(result.reason).toBe("a.ts: stale edit");
  });
  it("refuses a pre-existing temporary symlink without writing through it", () => {
    const temporary = join(root, `a.ts.devhub-lsp-${process.pid}.tmp`);
    fs.symlinkSync(join(root, "b.ts"), temporary);
    const result = apply({ changes: { [uri("a.ts")]: edits } });
    expect(result.applied).toBe(false);
    expect(fs.readFileSync(join(root, "b.ts"), "utf8")).toBe("bcd");
  });
  it.each(["delete", "rename"] as const)(
    "refuses %s before writing any file",
    (kind) => {
      const operation =
        kind === "delete"
          ? { kind, uri: uri("b.ts") }
          : { kind, oldUri: uri("b.ts"), newUri: uri("c.ts") };
      const result = apply({
        documentChanges: [
          { textDocument: { uri: uri("a.ts"), version: null }, edits },
          operation,
        ],
      });
      expect(result).toMatchObject({
        applied: false,
        reason: expect.stringContaining("b.ts"),
        changedUris: [],
      });
      expect(fs.readFileSync(join(root, "a.ts"), "utf8")).toBe("abc\r\n");
    },
  );
  it.each(["file:///outside/file.ts", "inmemory://model/1"])(
    "refuses an out-of-workspace URI %s",
    (target) => {
      const result = apply({ changes: { [target]: edits } });
      expect(result.applied).toBe(false);
    },
  );
  it("refuses symlink escapes for existing and new targets", () => {
    const outside = fs.mkdtempSync(join(tmpdir(), "lsp-outside-"));
    try {
      fs.writeFileSync(join(outside, "a.ts"), "safe");
      fs.symlinkSync(outside, join(root, "escape"));
      const results = [
        apply({ changes: { [uri("escape/a.ts")]: edits } }),
        apply({
          documentChanges: [{ kind: "create", uri: uri("escape/new.ts") }],
        }),
      ];
      expect(results.every((result) => !result.applied)).toBe(true);
      expect(fs.readFileSync(join(outside, "a.ts"), "utf8")).toBe("safe");
      expect(fs.existsSync(join(outside, "new.ts"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it("refuses stale versions when the tracked version differs", () => {
    synced.set(uri("a.ts"), { version: 2, text: "abc\r\n" });
    const result = apply({
      documentChanges: [
        { textDocument: { uri: uri("a.ts"), version: 1 }, edits },
      ],
    });
    expect(result.reason).toBe("a.ts: stale edit");
  });
  it("refuses unsaved synced text when it differs from disk", () => {
    synced.set(uri("a.ts"), { version: 1, text: "dirty" });
    const result = apply({ changes: { [uri("a.ts")]: edits } });
    expect(result.reason).toBe("a.ts has unsaved changes — save it first");
  });
  it("refuses a dirty tab when its model is no longer synced", () => {
    dirty.add(uri("a.ts"));
    const result = apply({ changes: { [uri("a.ts")]: edits } });
    expect(result.reason).toBe("a.ts has unsaved changes — save it first");
  });
  it.each(["missing.ts", "missing/new.ts"])(
    "refuses missing text target %s",
    (path) => {
      const result = apply({ changes: { [uri(path)]: edits } });
      expect(result).toMatchObject({
        applied: false,
        reason: expect.stringContaining(path),
      });
    },
  );
  it("refuses creation when its parent is missing", () => {
    const result = apply({
      documentChanges: [{ kind: "create", uri: uri("missing/new.ts") }],
    });
    expect(result).toMatchObject({
      applied: false,
      reason: expect.stringContaining("missing/new.ts"),
    });
  });
  it("refuses creation when the file already exists", () => {
    const result = apply({
      documentChanges: [{ kind: "create", uri: uri("a.ts") }],
    });
    expect(result).toMatchObject({
      applied: false,
      reason: expect.stringContaining("a.ts"),
    });
  });
  it("refuses overlapping edits before committing earlier files", () => {
    const result = apply({
      changes: { [uri("b.ts")]: edits, [uri("a.ts")]: [...edits, ...edits] },
    });
    expect(result.reason).toBe("a.ts: overlapping text edits");
    expect(fs.readFileSync(join(root, "b.ts"), "utf8")).toBe("bcd");
  });
});

describe("rollback", () => {
  it("restores bytes and removes temporary files when the second rename fails", () => {
    let calls = 0;
    const fsImpl: WriterFs = {
      ...diskFs,
      renameSync: (from, to) => {
        if (++calls === 2) throw new Error("disk failure");
        fs.renameSync(from, to);
      },
    };
    const result = apply(
      { changes: { [uri("a.ts")]: edits, [uri("b.ts")]: edits } },
      fsImpl,
    );
    expect(result.reason).toBe(
      "write failed: disk failure; changes rolled back",
    );
    expect(fs.readFileSync(join(root, "a.ts"))).toEqual(Buffer.from("abc\r\n"));
    expect(
      fs.readdirSync(root).filter((path) => path.endsWith(".tmp")),
    ).toEqual([]);
  });
  it("reports changed URIs honestly when commit and rollback writes fail", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const fsImpl: WriterFs = {
      ...diskFs,
      writeFileSync: (path, text, options) => {
        if (++calls >= 2) throw new Error("disk failure");
        fs.writeFileSync(path, text, options);
      },
    };
    const result = apply(
      { changes: { [uri("a.ts")]: edits, [uri("b.ts")]: edits } },
      fsImpl,
    );
    expect(result).toMatchObject({
      applied: false,
      reason: expect.stringContaining("rollback FAILED for a.ts"),
      changedUris: [uri("a.ts")],
      createdUris: [],
    });
    expect(console.error).toHaveBeenCalledWith("[lsp] rollback failed", [
      "a.ts",
    ]);
  });
  it("removes newly created files when a later write fails", () => {
    let calls = 0;
    const fsImpl: WriterFs = {
      ...diskFs,
      renameSync: (from, to) => {
        if (++calls === 2) throw new Error("failure");
        fs.renameSync(from, to);
      },
    };
    const result = apply(
      {
        documentChanges: [
          { kind: "create", uri: uri("new.ts") },
          { textDocument: { uri: uri("a.ts"), version: null }, edits },
        ],
      },
      fsImpl,
    );
    expect(result.changedUris).toEqual([]);
    expect(fs.existsSync(join(root, "new.ts"))).toBe(false);
  });
});
