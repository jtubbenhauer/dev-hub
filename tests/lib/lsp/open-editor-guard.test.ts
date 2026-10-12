import type * as Monaco from "monaco-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./open-editor-mocks";
import { registerLspOpenGuard } from "@/lib/lsp/client/open-editor";
import {
  createFakeEditor,
  fakeResource,
  mountSurface,
  workspaceUri,
} from "./open-editor-fixture";

const SOURCE_URI = workspaceUri("src/a.ts");
const TARGET = workspaceUri("src/b.ts");

afterEach(() => {
  document.body.replaceChildren();
});

function registerGuard(editors: readonly Monaco.editor.ICodeEditor[]) {
  const openers: Monaco.editor.ICodeEditorOpener[] = [];
  const guardDisposable = { dispose: vi.fn() };
  // The fake implements only the Monaco APIs the guard consumes.
  const monaco = {
    editor: {
      getEditors: () => editors,
      registerEditorOpener: vi.fn((opener: Monaco.editor.ICodeEditorOpener) => {
        openers.push(opener);
        return guardDisposable;
      }),
    },
  } as unknown as typeof Monaco;
  const disposable = registerLspOpenGuard(monaco);
  return {
    disposable,
    guardDisposable,
    open: (source: Monaco.editor.ICodeEditor, uri: string) =>
      openers[0].openCodeEditor(source, fakeResource(uri)),
  };
}

describe("registerLspOpenGuard", () => {
  it("returns the registered opener's disposable", () => {
    const guard = registerGuard([]);

    expect(guard.disposable).toBe(guard.guardDisposable);
  });

  it("lets a same-file jump through to the source editor", () => {
    const source = createFakeEditor(
      mountSurface(null).container,
      SOURCE_URI,
    ).editor;
    const guard = registerGuard([source]);

    expect(guard.open(source, SOURCE_URI)).toBe(false);
  });

  it("swallows a cross-file open from an editor outside any surface", () => {
    const dialog = createFakeEditor(
      mountSurface(null).container,
      SOURCE_URI,
    ).editor;
    const splitPanel = createFakeEditor(
      mountSurface("split-panel").container,
      TARGET,
    ).editor;
    const guard = registerGuard([dialog, splitPanel]);

    expect(guard.open(dialog, TARGET)).toBe(true);
  });

  it("swallows an open whose target is shown by a top-level editor of another surface", () => {
    const source = createFakeEditor(
      mountSurface("files-page").container,
      SOURCE_URI,
    ).editor;
    const splitPanel = createFakeEditor(
      mountSurface("split-panel").container,
      TARGET.toUpperCase(),
    ).editor;
    const guard = registerGuard([source, splitPanel]);

    expect(guard.open(source, TARGET)).toBe(true);
  });

  it("lets the editor service continue when only a nested peek editor shows the target", () => {
    const filesPage = mountSurface("files-page");
    const source = createFakeEditor(filesPage.container, SOURCE_URI).editor;
    const peek = createFakeEditor(
      mountSurface("split-panel").peekContainer,
      TARGET,
    ).editor;
    const guard = registerGuard([source, peek]);

    expect(guard.open(source, TARGET)).toBe(false);
  });

  it("lets the editor service continue when no editor shows the target", () => {
    const source = createFakeEditor(
      mountSurface("files-page").container,
      SOURCE_URI,
    ).editor;
    const guard = registerGuard([source]);

    expect(guard.open(source, TARGET)).toBe(false);
  });
});
