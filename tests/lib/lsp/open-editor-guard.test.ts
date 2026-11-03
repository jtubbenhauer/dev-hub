import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./open-editor-mocks";
import { registerLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";
import { registerLspOpenGuard } from "@/lib/lsp/client/open-editor";
import {
  createFakeEditor,
  fakeResource,
  mountSurface,
  workspaceUri,
} from "./open-editor-fixture";

const SOURCE_URI = workspaceUri("src/a.ts");
const TARGET = workspaceUri("src/b.ts");
const openTab =
  vi.fn<(relativePath: string, isCurrent: () => boolean) => Promise<boolean>>();
let unregisterOpenTab = () => {};

beforeEach(() => {
  openTab.mockReset().mockResolvedValue(true);
  unregisterOpenTab = registerLspOpenFileHandler("files-page", openTab);
});
afterEach(() => {
  unregisterOpenTab();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mountHiddenFilesPage() {
  const dom = mountSurface("files-page");
  dom.surface.style.visibility = "hidden";
  return dom;
}

function trackSettled(result: boolean | Promise<boolean>) {
  const tracked = { isSettled: false, promise: Promise.resolve(result) };
  tracked.promise = tracked.promise.then((value) => {
    tracked.isSettled = true;
    return value;
  });
  return tracked;
}

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

function editorsWithHiddenTarget() {
  const source = createFakeEditor(
    mountSurface("files-page").container,
    SOURCE_URI,
  ).editor;
  const hiddenPage = mountHiddenFilesPage();
  const hidden = createFakeEditor(hiddenPage.container, TARGET).editor;
  return { source, hiddenPage, guard: registerGuard([source, hidden]) };
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
    const filesPage = createFakeEditor(
      mountSurface("files-page").container,
      TARGET,
    ).editor;
    const guard = registerGuard([dialog, filesPage]);

    expect(guard.open(dialog, TARGET)).toBe(true);
  });

  it("swallows an open whose target is shown by a top-level editor outside the surface", () => {
    const source = createFakeEditor(
      mountSurface("files-page").container,
      SOURCE_URI,
    ).editor;
    const outside = createFakeEditor(
      mountSurface(null).container,
      TARGET.toUpperCase(),
    ).editor;
    const guard = registerGuard([source, outside]);

    expect(guard.open(source, TARGET)).toBe(true);
  });

  it("lets the editor service continue when only a nested peek editor shows the target", () => {
    const filesPage = mountSurface("files-page");
    const source = createFakeEditor(filesPage.container, SOURCE_URI).editor;
    const peek = createFakeEditor(
      mountSurface(null).peekContainer,
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

  it("lets the editor service continue without a tab switch when a visible editor of the surface shows the target", () => {
    // Given
    const source = createFakeEditor(
      mountSurface("files-page").container,
      SOURCE_URI,
    ).editor;
    const visible = createFakeEditor(
      mountSurface("files-page").container,
      TARGET,
    ).editor;
    const guard = registerGuard([source, visible]);

    // When
    const result = guard.open(source, TARGET);

    // Then
    expect(result).toBe(false);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("opens the tab of a hidden editor of the surface that shows the target", async () => {
    // Given
    const { source, hiddenPage, guard } = editorsWithHiddenTarget();
    openTab.mockImplementation(async () => {
      hiddenPage.surface.style.visibility = "";
      return true;
    });

    // When
    const result = await guard.open(source, TARGET);

    // Then
    expect(result).toBe(false);
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      "src/b.ts",
      expect.any(Function),
    );
  });

  it("lets the editor service continue only once the hidden target's editor is shown", async () => {
    // Given
    vi.useFakeTimers();
    const { source, hiddenPage, guard } = editorsWithHiddenTarget();
    const result = trackSettled(guard.open(source, TARGET));
    await vi.advanceTimersByTimeAsync(200);
    expect(result.isSettled).toBe(false);

    // When
    hiddenPage.surface.style.visibility = "";
    await vi.advanceTimersByTimeAsync(50);

    // Then
    expect(result.isSettled).toBe(true);
    expect(await result.promise).toBe(false);
  });

  it("stops waiting for a target editor that stays hidden", async () => {
    // Given
    vi.useFakeTimers();
    const { source, guard } = editorsWithHiddenTarget();
    const result = trackSettled(guard.open(source, TARGET));
    await vi.advanceTimersByTimeAsync(950);
    expect(result.isSettled).toBe(false);

    // When
    await vi.advanceTimersByTimeAsync(50);

    // Then
    expect(result.isSettled).toBe(true);
  });

  it("lets the editor service continue at once when the tab could not be opened", async () => {
    // Given
    vi.useFakeTimers();
    openTab.mockResolvedValue(false);
    const { source, guard } = editorsWithHiddenTarget();

    // When
    const result = trackSettled(guard.open(source, TARGET));
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(result.isSettled).toBe(true);
    expect(await result.promise).toBe(false);
  });
});
