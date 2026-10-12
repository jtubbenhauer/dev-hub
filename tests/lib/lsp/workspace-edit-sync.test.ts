import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { handleWorkspaceEditResult } from "@/lib/lsp/client/workspace-edit-sync";
import { useEditorStore } from "@/stores/editor-store";
import { useSidePanelStore } from "@/stores/side-panel-store";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import type { LspWorkspaceEditResult } from "@/lib/lsp/types";
import { subscribeToGitStatusRefresh } from "@/lib/git/git-status-refresh";
import {
  model,
  deferredResponse,
} from "@/tests/lib/lsp/workspace-edit-sync-fixture";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
const uri = "file:///repo/src/a.ts";
const warning = "src/a.ts changed on disk; your unsaved copy was kept";
const result: LspWorkspaceEditResult = {
  applied: true,
  reason: null,
  changedUris: [uri],
  createdUris: [],
};
const fetchMock = vi.fn<typeof fetch>();
let models: ReturnType<typeof model>[];
// The hand-rolled browser fake implements only the Monaco methods this adapter consumes.
const monaco = {
  editor: { getModels: () => models },
} as unknown as typeof import("monaco-editor");
const context = { monaco, workspaceId: "A & B", workspaceRoot: "/repo" };
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset().mockResolvedValue(Response.json({ content: "disk" }));
  vi.stubGlobal("fetch", fetchMock);
  models = [model()];
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSidePanelStore.setState(useSidePanelStore.getInitialState(), true);
  useChatFileDialogStore.getState().reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace edit reload", () => {
  it("shows the refusal when no files changed", async () => {
    await handleWorkspaceEditResult(
      { ...result, applied: false, reason: "save it first", changedUris: [] },
      context,
    );
    expect(toast.error).toHaveBeenCalledWith("Edit not applied: save it first");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reloads disk when a refused edit reports rollback failures", async () => {
    await handleWorkspaceEditResult(
      { ...result, applied: false, reason: "rollback FAILED" },
      context,
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Edit not applied: rollback FAILED",
    );
    expect(models[0].getValue()).toBe("disk");
  });
  it("calls every store and preserves undo when an edit applies", async () => {
    const editor = vi.spyOn(
      useEditorStore.getState(),
      "replaceFileContentFromDisk",
    );
    const side = vi.spyOn(
      useSidePanelStore.getState(),
      "replaceFileContentFromDisk",
    );
    const dialog = vi.spyOn(
      useChatFileDialogStore.getState(),
      "replaceContentFromDisk",
    );
    await handleWorkspaceEditResult(result, context);
    for (const action of [editor, side, dialog])
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "A & B",
        "src/a.ts",
        "disk",
      );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/files/content?workspaceId=A%20%26%20B&path=src%2Fa.ts",
    );
    expect(models[0].pushEditOperations).toHaveBeenCalledWith(
      [],
      [{ range: models[0].getFullModelRange(), text: "disk" }],
      expect.any(Function),
    );
    expect(models[0].getValue()).toBe("disk");
  });
  it.each([useEditorStore, useSidePanelStore, useChatFileDialogStore])(
    "keeps all matching models when a store becomes dirty during fetch",
    async (store) => {
      const pending = deferredResponse();
      fetchMock.mockReturnValueOnce(pending.promise);
      models.push(model(uri.toUpperCase()));
      const reload = handleWorkspaceEditResult(result, context);
      const state = store.getState();
      if ("replaceFileContentFromDisk" in state)
        vi.spyOn(state, "replaceFileContentFromDisk").mockReturnValue(
          "dirty-skipped",
        );
      else
        vi.spyOn(state, "replaceContentFromDisk").mockReturnValue(
          "dirty-skipped",
        );
      pending.resolve(Response.json({ content: "disk" }));
      await reload;
      expect(toast.warning).toHaveBeenCalledWith(warning);
      for (const item of models)
        expect(item.pushEditOperations).not.toHaveBeenCalled();
    },
  );
  it("keeps model typing when the fetch is pending", async () => {
    fetchMock.mockImplementationOnce(async () => {
      models[0].type("unsaved");
      return Response.json({ content: "disk" });
    });
    await handleWorkspaceEditResult(result, context);
    expect(models[0].getValue()).toBe("unsaved");
    expect(models[0].pushEditOperations).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(warning);
  });
  it("discards the older result entirely when fetches resolve in reverse order", async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    fetchMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const editor = vi.spyOn(
      useEditorStore.getState(),
      "replaceFileContentFromDisk",
    );
    const side = vi.spyOn(
      useSidePanelStore.getState(),
      "replaceFileContentFromDisk",
    );
    const dialog = vi.spyOn(
      useChatFileDialogStore.getState(),
      "replaceContentFromDisk",
    );
    const first = handleWorkspaceEditResult(result, context);
    const second = handleWorkspaceEditResult(result, context);
    newer.resolve(Response.json({ content: "newer" }));
    await second;
    older.resolve(Response.json({ content: "older" }));
    await first;
    for (const action of [editor, side, dialog])
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "A & B",
        "src/a.ts",
        "newer",
      );
    expect(models[0].getValue()).toBe("newer");
    expect(models[0].pushEditOperations).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });
  it("discards an old response when a newer reload is still pending", async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    fetchMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const action = vi.spyOn(
      useEditorStore.getState(),
      "replaceFileContentFromDisk",
    );
    const first = handleWorkspaceEditResult(result, context);
    const second = handleWorkspaceEditResult(result, context);
    older.resolve(Response.json({ content: "older" }));
    await first;
    expect(action).not.toHaveBeenCalled();
    newer.resolve(Response.json({ content: "newer" }));
    await second;
    expect(models[0].getValue()).toBe("newer");
  });
  it("captures every URI before awaiting another URI", async () => {
    const pending = deferredResponse();
    const secondModel = model("file:///repo/src/b.ts");
    models.push(secondModel);
    fetchMock.mockReturnValueOnce(pending.promise);
    const reload = handleWorkspaceEditResult(
      { ...result, changedUris: [uri, "file:///repo/src/b.ts"] },
      context,
    );
    secondModel.type("typed during reload");
    pending.resolve(Response.json({ content: "disk" }));
    await reload;
    expect(secondModel.pushEditOperations).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      "src/b.ts changed on disk; your unsaved copy was kept",
    );
  });
  it.each(["http", "network", "json", "shape"])(
    "skips a failed URI but reloads others when failure is %s",
    async (failure) => {
      switch (failure) {
        case "http":
          fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
          break;
        case "network":
          fetchMock.mockRejectedValueOnce(new TypeError("offline"));
          break;
        case "json":
          fetchMock.mockResolvedValueOnce(new Response("invalid json"));
          break;
        case "shape":
          fetchMock.mockResolvedValueOnce(Response.json({ content: 42 }));
          break;
      }
      const other = model("file:///repo/b.ts");
      models.push(other);
      await handleWorkspaceEditResult(
        { ...result, changedUris: [uri, "file:///repo/b.ts"] },
        context,
      );
      expect(models[0].pushEditOperations).not.toHaveBeenCalled();
      expect(other.getValue()).toBe("disk");
    },
  );
  it("requests a git status refresh after an applied edit", async () => {
    const gitStatusRefreshListener = vi.fn();
    const unsubscribe = subscribeToGitStatusRefresh(gitStatusRefreshListener);
    await handleWorkspaceEditResult(result, context);
    unsubscribe();
    expect(gitStatusRefreshListener).toHaveBeenCalledExactlyOnceWith("A & B");
  });
  it("skips the git status refresh when a refused edit changed nothing", async () => {
    const gitStatusRefreshListener = vi.fn();
    const unsubscribe = subscribeToGitStatusRefresh(gitStatusRefreshListener);
    await handleWorkspaceEditResult(
      { ...result, applied: false, reason: "save it first", changedUris: [] },
      context,
    );
    unsubscribe();
    expect(gitStatusRefreshListener).not.toHaveBeenCalled();
  });
  it("skips outside-workspace and non-file URIs", async () => {
    await handleWorkspaceEditResult(
      {
        ...result,
        changedUris: ["file:///elsewhere/a.ts", "https://example.com/a.ts"],
      },
      context,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ignores disposed, unchanged and unrelated models while updating a case-folded match", async () => {
    const disposed = models[0];
    disposed.isDisposed.mockReturnValue(true);
    const unchanged = model();
    unchanged.type("disk");
    const unrelated = model("file:///repo/other.ts");
    const matching = model(uri.toUpperCase());
    models.push(unchanged, unrelated, matching);
    await handleWorkspaceEditResult(result, context);
    for (const item of [disposed, unchanged, unrelated])
      expect(item.pushEditOperations).not.toHaveBeenCalled();
    expect(matching.getValue()).toBe("disk");
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
