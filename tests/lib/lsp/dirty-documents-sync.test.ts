import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDirtyDocumentsSync } from "@/lib/lsp/client/dirty-documents-sync";
import { useEditorStore } from "@/stores/editor-store";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import type { OpenFile } from "@/types";

const disposables: { dispose(): void }[] = [];
const tab = (overrides: Partial<OpenFile> = {}): OpenFile => ({
  path: "src/a.ts",
  name: "a.ts",
  language: "typescript",
  content: "dirty",
  originalContent: "base",
  isDirty: true,
  workspaceId: "A",
  ...overrides,
});
function start(workspaceId = "A") {
  const send = vi.fn<(uris: string[]) => void>();
  disposables.push(
    startDirtyDocumentsSync({ workspaceId, workspaceRoot: "/repo", send }),
  );
  return send;
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useChatFileDialogStore.getState().reset();
});
afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose();
});

describe("dirty documents sync", () => {
  it("sends an empty set immediately when no tab is dirty", () => {
    const send = start();
    expect(send.mock.calls).toEqual([[[]]]);
  });
  it("sends sorted unique encoded URIs when dirty tabs already exist", () => {
    useEditorStore.setState({
      openFiles: [
        tab({ path: "src/z.ts" }),
        tab(),
        tab({ path: "my file.ts" }),
      ],
    });
    useChatFileDialogStore.setState({
      file: {
        workspaceId: "A",
        content: "dirty",
        path: "src/a.ts",
        instanceId: 1,
        language: "typescript",
      },
      originalContent: "base",
    });
    const send = start();
    expect(send.mock.calls).toEqual([
      [
        [
          "file:///repo/my%20file.ts",
          "file:///repo/src/a.ts",
          "file:///repo/src/z.ts",
        ],
      ],
    ]);
  });
  describe("editor tabs", () => {
    it("sends once synchronously when a clean tab becomes dirty", () => {
      useEditorStore.setState({
        openFiles: [tab({ content: "base", isDirty: false })],
      });
      const send = start();
      useEditorStore.getState().updateFileContent("src/a.ts", "typed");
      expect(send.mock.calls).toEqual([[[]], [["file:///repo/src/a.ts"]]]);
    });
    it("sends nothing when further keystrokes keep the same set", () => {
      useEditorStore.setState({ openFiles: [tab()] });
      const send = start();
      useEditorStore.getState().updateFileContent("src/a.ts", "more typing");
      expect(send).toHaveBeenCalledTimes(1);
    });
    it("sends the smaller set when a dirty tab is saved", () => {
      useEditorStore.setState({
        openFiles: [tab(), tab({ path: "src/b.ts" })],
      });
      const send = start();
      useEditorStore.getState().markFileSaved("src/a.ts");
      expect(send).toHaveBeenLastCalledWith(["file:///repo/src/b.ts"]);
      expect(send).toHaveBeenCalledTimes(2);
    });
    it.each(["A", "B"])(
      "attributes a dirty A tab correctly when session is %s",
      (workspaceId) => {
        useEditorStore.setState({ openFiles: [tab()] });
        const send = start(workspaceId);
        expect(send).toHaveBeenCalledExactlyOnceWith(
          workspaceId === "A" ? ["file:///repo/src/a.ts"] : [],
        );
      },
    );
    it("reports legacy dirty tabs when workspaceId is absent", () => {
      const legacy = tab();
      delete legacy.workspaceId;
      useEditorStore.setState({ openFiles: [legacy] });
      const send = start("B");
      expect(send).toHaveBeenCalledExactlyOnceWith(["file:///repo/src/a.ts"]);
    });
  });
  it.each([
    {
      workspaceId: "A",
      content: "dirty",
      expected: ["file:///repo/dialog.ts"],
    },
    { workspaceId: "B", content: "dirty", expected: [] },
    { workspaceId: "A", content: "base", expected: [] },
  ])(
    "reports dialog changes only for matching dirty content: $workspaceId/$content",
    ({ workspaceId, content, expected }) => {
      const send = start();
      useChatFileDialogStore.setState({
        file: {
          workspaceId,
          content,
          path: "dialog.ts",
          instanceId: 1,
          language: "typescript",
        },
        originalContent: "base",
      });
      expect(send).toHaveBeenLastCalledWith(expected);
      expect(send).toHaveBeenCalledTimes(expected.length ? 2 : 1);
    },
  );
  it("sends the empty set when the dialog is saved", () => {
    useChatFileDialogStore.setState({
      file: {
        workspaceId: "A",
        content: "dirty",
        path: "dialog.ts",
        instanceId: 1,
        language: "typescript",
      },
      originalContent: "base",
    });
    const send = start();
    useChatFileDialogStore.getState().markSaved();
    expect(send.mock.calls).toEqual([[["file:///repo/dialog.ts"]], [[]]]);
  });
  it("does not resend when store ordering or unrelated state changes", () => {
    const files = [tab(), tab({ path: "src/b.ts" })];
    useEditorStore.setState({ openFiles: files });
    const send = start();
    useEditorStore.setState({
      openFiles: [...files].reverse(),
      activeFilePath: "src/b.ts",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("unsubscribes from all stores when disposed", () => {
    const send = start();
    for (const disposable of disposables) disposable.dispose();
    useEditorStore.setState({ openFiles: [tab()] });
    useChatFileDialogStore.setState({
      file: {
        workspaceId: "A",
        content: "dirty",
        path: "dialog.ts",
        instanceId: 1,
        language: "typescript",
      },
      originalContent: "base",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
