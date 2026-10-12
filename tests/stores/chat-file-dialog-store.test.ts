import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

const store = useChatFileDialogStore;
const open = (workspaceId = "A", path = "a.ts") =>
  store.getState().openFile(workspaceId, path, vi.fn());
beforeEach(() => {
  store.getState().reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ content: "base", language: "typescript" }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("chat file dialog store", () => {
  beforeEach(() => {
    useChatFileDialogStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("loads a file and opens it in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: "const value = 1;",
            language: "typescript",
          }),
          { status: 200 },
        ),
      ),
    );
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "src/value.ts", fallback);

    const state = useChatFileDialogStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.file).toEqual({
      path: "src/value.ts",
      content: "const value = 1;",
      language: "typescript",
      workspaceId: "workspace-1",
      instanceId: expect.any(Number),
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("opens PDFs as a preview without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "docs/spec.pdf", fallback);

    const state = useChatFileDialogStore.getState();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.isOpen).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.file).toEqual({
      path: "docs/spec.pdf",
      content: "",
      language: "pdf",
      workspaceId: "workspace-1",
      instanceId: expect.any(Number),
    });
  });

  it("opens images as a preview without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "assets/logo.png", fallback);

    const state = useChatFileDialogStore.getState();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(state.isOpen).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.file).toEqual({
      path: "assets/logo.png",
      content: "",
      language: "image",
      workspaceId: "workspace-1",
      instanceId: expect.any(Number),
    });
  });

  it("uses the full editor fallback when the file cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "missing.ts", fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(useChatFileDialogStore.getState().isOpen).toBe(false);
  });
});

describe("dialog file identity", () => {
  it("assigns a fresh instance on each successful open", async () => {
    await open();
    const previous = store.getState().file;
    await open();
    expect(store.getState().file?.instanceId).toEqual(expect.any(Number));
    expect(store.getState().file?.instanceId).not.toBe(previous?.instanceId);
  });
  it("keeps typing after a save dirty", async () => {
    await open();
    const file = store.getState().file;
    if (!file) throw new Error("Missing fixture");
    store.getState().setContent("v1");
    const snapshot = { ...file, submittedBase: "base", savedContent: "v1" };
    store.getState().setContent("v2");
    expect(store.getState().markSavedAs(snapshot)).toBe("acknowledged");
    expect(store.getState().originalContent).toBe("v1");
    expect(store.getState().file?.content).toBe("v2");
  });
  it.each(["workspace", "path", "instance", "base", "closed"])(
    "ignores a save after changing %s",
    async (change) => {
      await open();
      const file = store.getState().file;
      if (!file) throw new Error("Missing fixture");
      if (change === "base")
        store.getState().replaceContentFromDisk("A", "a.ts", "new base");
      else if (change === "closed") store.getState().reset();
      else
        await open(
          change === "workspace" ? "B" : "A",
          change === "path" ? "b.ts" : "a.ts",
        );
      const before = store.getState();
      expect(
        store
          .getState()
          .markSavedAs({ ...file, submittedBase: "base", savedContent: "v1" }),
      ).toBe("ignored");
      expect(store.getState()).toBe(before);
    },
  );
  it.each([false, true])(
    "does not reload a foreign dialog, dirty=%s",
    async (isDirty) => {
      await open();
      if (isDirty) store.getState().setContent("dirty");
      const before = store.getState();
      expect(store.getState().replaceContentFromDisk("B", "a.ts", "disk")).toBe(
        "not-open",
      );
      expect(store.getState()).toBe(before);
    },
  );
  it("replaces both contents for a matching clean file", async () => {
    await open();
    expect(store.getState().replaceContentFromDisk("A", "a.ts", "disk")).toBe(
      "replaced",
    );
    expect(store.getState().originalContent).toBe("disk");
    expect(store.getState().file?.content).toBe("disk");
  });
  it("skips a matching dirty file", async () => {
    await open();
    store.getState().setContent("dirty");
    const before = store.getState();
    expect(store.getState().replaceContentFromDisk("A", "a.ts", "disk")).toBe(
      "dirty-skipped",
    );
    expect(store.getState()).toBe(before);
  });
});
