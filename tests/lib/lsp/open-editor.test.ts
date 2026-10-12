import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lspSessionState as state } from "./open-editor-mocks";
import {
  registerLspOpenFileHandler,
  takePendingNavigation,
} from "@/lib/lsp/client/navigation-registry";
import { openEditorFromLsp } from "@/lib/lsp/client/open-editor";
import {
  buildSurface,
  createFakeEditor,
  createModelRef,
  mountSurface,
  selectionOptions,
  workspaceUri,
} from "./open-editor-fixture";

const TARGET = workspaceUri("src/b.ts");
const handler =
  vi.fn<(relativePath: string, isCurrent: () => boolean) => Promise<boolean>>();
let unregisterHandler = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  state.root = "/Workspace";
  state.editors = [];
  state.onGetEditors = undefined;
  handler.mockReset();
  unregisterHandler = registerLspOpenFileHandler("split-panel", handler);
});
afterEach(() => {
  unregisterHandler();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function focusedSplitPanel() {
  const dom = mountSurface("split-panel");
  dom.focusTarget.focus();
  return dom;
}

describe("openEditorFromLsp", () => {
  it("opens an in-scope target and resolves with the top-level editor, not the peek showing it", async () => {
    const dom = focusedSplitPanel();
    const peek = createFakeEditor(dom.peekContainer, TARGET);
    const top = createFakeEditor(dom.container, TARGET);
    state.editors = [peek.editor];
    let isCurrentAtHandler = false;
    handler.mockImplementation(async (_relativePath, isCurrent) => {
      isCurrentAtHandler = isCurrent();
      state.editors = [peek.editor, top.editor];
      return true;
    });
    const { ref, dispose } = createModelRef(TARGET);

    const editor = await openEditorFromLsp(ref, selectionOptions(3, 5, 11));

    expect(handler).toHaveBeenCalledExactlyOnceWith(
      "src/b.ts",
      expect.any(Function),
    );
    expect(isCurrentAtHandler).toBe(true);
    expect(editor).toBe(top.editor);
    const range = {
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 11,
    };
    expect(top.setSelection).toHaveBeenCalledExactlyOnceWith(range);
    expect(top.revealRangeInCenter).toHaveBeenCalledExactlyOnceWith(range);
    expect(top.focus).toHaveBeenCalledOnce();
    expect(peek.setSelection).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes the model reference exactly once on the editor's next model change", async () => {
    const dom = focusedSplitPanel();
    const top = createFakeEditor(dom.container, TARGET);
    state.editors = [top.editor];
    handler.mockResolvedValue(true);
    const { ref, dispose } = createModelRef(TARGET);
    await openEditorFromLsp(ref, undefined);
    expect(top.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispose).not.toHaveBeenCalled();

    top.showUri(workspaceUri("src/a.ts"));
    top.showUri(workspaceUri("src/c.ts"));
    top.fireDispose();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("resolves with the editor remounted inside a replacement surface of the same name", async () => {
    const dom = focusedSplitPanel();
    const unmounted = createFakeEditor(dom.container, TARGET);
    let remounted = unmounted;
    handler.mockImplementation(async () => {
      const replacement = buildSurface("split-panel");
      dom.surface.replaceWith(replacement.surface);
      remounted = createFakeEditor(replacement.container, TARGET);
      state.editors = [unmounted.editor, remounted.editor];
      return true;
    });

    const editor = await openEditorFromLsp(createModelRef(TARGET).ref, {});

    expect(editor).toBe(remounted.editor);
    expect(unmounted.setSelection).not.toHaveBeenCalled();
  });

  it("never returns an editor of a different surface that shows the target", async () => {
    const filesPage = mountSurface("files-page");
    const otherSurface = createFakeEditor(filesPage.container, TARGET);
    const dom = focusedSplitPanel();
    const top = createFakeEditor(dom.container, TARGET);
    state.editors = [otherSurface.editor];
    handler.mockImplementation(async () => {
      state.editors = [otherSurface.editor, top.editor];
      return true;
    });

    const editor = await openEditorFromLsp(createModelRef(TARGET).ref, {});

    expect(editor).toBe(top.editor);
    expect(otherSurface.setSelection).not.toHaveBeenCalled();
  });

  it("returns undefined without calling a handler when the focus has no surface", async () => {
    mountSurface(null).focusTarget.focus();
    const { ref, dispose } = createModelRef(TARGET);

    await expect(openEditorFromLsp(ref, {})).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["outside the workspace", "file:///Elsewhere/src/b.ts", "/Workspace"],
    ["not a TS/JS document", workspaceUri("README.md"), "/Workspace"],
    ["without an active session", TARGET, null],
  ])("returns undefined for a target %s", async (_case, uri, workspaceRoot) => {
    focusedSplitPanel();
    state.root = workspaceRoot;
    const { ref, dispose } = createModelRef(uri);

    await expect(openEditorFromLsp(ref, {})).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns undefined at once when the handler fails to open the tab", async () => {
    focusedSplitPanel();
    handler.mockResolvedValue(false);
    const { ref, dispose } = createModelRef(TARGET);

    await expect(openEditorFromLsp(ref, {})).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("clears the pending navigation when the handler rejects", async () => {
    focusedSplitPanel();
    handler.mockRejectedValue(new Error("open failed"));
    const { ref, dispose } = createModelRef(TARGET);

    await expect(openEditorFromLsp(ref, {})).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledOnce();
    expect(takePendingNavigation("split-panel", TARGET.toLowerCase())).toBe(
      null,
    );
  });

  it("returns undefined after 5 s when only a peek editor shows the target", async () => {
    const dom = focusedSplitPanel();
    const peek = createFakeEditor(dom.peekContainer, TARGET);
    state.editors = [peek.editor];
    handler.mockResolvedValue(true);
    const { ref, dispose } = createModelRef(TARGET);
    let result: Monaco.editor.ICodeEditor | undefined | "pending" = "pending";
    void openEditorFromLsp(ref, {}).then((editor) => {
      result = editor;
    });

    await vi.advanceTimersByTimeAsync(4_900);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);

    expect(result).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    expect(peek.setSelection).not.toHaveBeenCalled();
  });
});
