import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lspSessionState as state } from "./open-editor-mocks";
import { registerLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";
import { openEditorFromLsp } from "@/lib/lsp/client/open-editor";
import {
  createFakeEditor,
  createModelRef,
  deferred,
  mountSurface,
  selectionOptions,
  workspaceUri,
} from "./open-editor-fixture";

const TARGET_A = workspaceUri("src/a.ts");
const TARGET_B = workspaceUri("src/b.ts");
const RANGE_B = {
  startLineNumber: 7,
  startColumn: 2,
  endLineNumber: 7,
  endColumn: 9,
};
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

function focusedSplitPanelEditor() {
  const dom = mountSurface("split-panel");
  dom.focusTarget.focus();
  const top = createFakeEditor(dom.container, workspaceUri("src/start.ts"));
  return top;
}

function isCurrentOfCall(callIndex: number): () => boolean {
  return handler.mock.calls[callIndex][1];
}

describe("openEditorFromLsp superseded navigation", () => {
  it("abandons A when B starts later and their handlers resolve in reverse order", async () => {
    const top = focusedSplitPanelEditor();
    state.editors = [top.editor];
    const openA = deferred<boolean>();
    const openB = deferred<boolean>();
    handler
      .mockImplementationOnce(() => openA.promise)
      .mockImplementationOnce(() => openB.promise);
    const refA = createModelRef(TARGET_A);
    const refB = createModelRef(TARGET_B);

    const navigationA = openEditorFromLsp(refA.ref, selectionOptions(2, 1, 4));
    expect(isCurrentOfCall(0)()).toBe(true);
    const navigationB = openEditorFromLsp(refB.ref, selectionOptions(7, 2, 9));
    expect(isCurrentOfCall(0)()).toBe(false);
    expect(isCurrentOfCall(1)()).toBe(true);
    top.showUri(TARGET_B);
    openB.resolve(true);
    await expect(navigationB).resolves.toBe(top.editor);
    top.showUri(TARGET_A);
    openA.resolve(true);

    await expect(navigationA).resolves.toBeUndefined();
    expect(refA.dispose).toHaveBeenCalledOnce();
    expect(top.setSelection).toHaveBeenCalledExactlyOnceWith(RANGE_B);
    expect(top.focus).toHaveBeenCalledOnce();
  });

  it("stops A's poll when B starts after A's handler already opened the tab", async () => {
    const top = focusedSplitPanelEditor();
    state.editors = [top.editor];
    const openB = deferred<boolean>();
    handler
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => openB.promise);
    const refA = createModelRef(TARGET_A);
    const refB = createModelRef(TARGET_B);
    let resultA: unknown = "pending";
    void openEditorFromLsp(refA.ref, selectionOptions(2, 1, 4)).then(
      (editor) => {
        resultA = editor;
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(resultA).toBe("pending");

    const navigationB = openEditorFromLsp(refB.ref, selectionOptions(7, 2, 9));
    await vi.advanceTimersByTimeAsync(50);
    expect(resultA).toBeUndefined();
    expect(refA.dispose).toHaveBeenCalledOnce();
    top.showUri(TARGET_B);
    openB.resolve(true);

    await expect(navigationB).resolves.toBe(top.editor);
    expect(top.setSelection).toHaveBeenCalledExactlyOnceWith(RANGE_B);
    expect(top.focus).toHaveBeenCalledOnce();
  });

  it("abandons A when B starts between A's successful wait and its continuation", async () => {
    const top = focusedSplitPanelEditor();
    top.showUri(TARGET_A);
    state.editors = [top.editor];
    handler
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => deferred<boolean>().promise);
    const refA = createModelRef(TARGET_A);
    const refB = createModelRef(TARGET_B);
    state.onGetEditors = () => {
      state.onGetEditors = undefined;
      void openEditorFromLsp(refB.ref, selectionOptions(7, 2, 9));
    };

    await expect(
      openEditorFromLsp(refA.ref, selectionOptions(2, 1, 4)),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(refA.dispose).toHaveBeenCalledOnce();
    expect(top.setSelection).not.toHaveBeenCalled();
    expect(top.focus).not.toHaveBeenCalled();
  });
});
