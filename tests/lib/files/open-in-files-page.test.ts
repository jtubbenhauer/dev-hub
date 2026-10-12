import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";
import { openFileInFilesPage } from "@/lib/files/open-in-files-page";
import { useEditorStore } from "@/stores/editor-store";
import {
  isPendingNavigationCurrent,
  setPendingNavigation,
} from "@/lib/lsp/client/navigation-registry";
import { IMAGE_LANGUAGE } from "@/lib/file-preview";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
const input = {
  workspaceId: "ws-1",
  path: "src/target.ts",
  isFileTabsDisabled: true,
};
function seed(path: string, isDirty = false, workspaceId?: string) {
  useEditorStore.getState().openFile({
    path,
    workspaceId,
    name: path,
    content: isDirty ? "unsaved" : "clean",
    originalContent: "clean",
    language: "typescript",
    isDirty,
  });
}
const response = () =>
  Response.json({ content: "disk", language: "typescript" });

describe("openFileInFilesPage", () => {
  beforeEach(() => {
    useEditorStore.getState().closeAllFiles();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([404, "throw", "malformed"])(
    "leaves tabs unchanged when fetch fails with %s",
    async (failure) => {
      seed("old.ts", true);
      const before = useEditorStore.getState();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failure === "throw") throw new TypeError("offline");
          return failure === "malformed"
            ? Response.json({ content: 7 })
            : new Response(null, { status: 404 });
        }),
      );

      expect(await openFileInFilesPage(input)).toBe(false);
      expect(useEditorStore.getState()).toBe(before);
    },
  );

  it("refuses navigation when another tab is dirty", async () => {
    seed("dirty.ts", true);
    seed("clean.ts");
    const before = useEditorStore.getState();

    expect(await openFileInFilesPage(input)).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith(
      "Save or discard your unsaved changes before opening another file",
    );
    expect(useEditorStore.getState()).toBe(before);
  });

  it.each([true, false])(
    "preserves an already-open dirty target when tabs disabled is %s",
    async (isFileTabsDisabled) => {
      seed(input.path, true);

      expect(await openFileInFilesPage({ ...input, isFileTabsDisabled })).toBe(
        true,
      );
      expect(useEditorStore.getState().openFiles).toEqual([
        expect.objectContaining({
          path: input.path,
          content: "unsaved",
          isDirty: true,
        }),
      ]);
      expect(useEditorStore.getState().activeFilePath).toBe(input.path);
    },
  );

  it("closes only clean others when discard is forbidden", async () => {
    seed("old.ts");
    seed("other.ts");

    expect(await openFileInFilesPage(input)).toBe(true);
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({
        path: input.path,
        content: "disk",
        name: "target.ts",
      }),
    ]);
  });

  it("guards dirty other tabs even when the target is already open", async () => {
    seed("other.ts", true);
    seed(input.path, true);

    const before = useEditorStore.getState();
    expect(await openFileInFilesPage(input)).toBe(false);
    expect(useEditorStore.getState()).toBe(before);
    expect(toast.warning).toHaveBeenCalled();
  });

  it("retains other tabs when tabs are enabled", async () => {
    seed("other.ts", true);

    expect(
      await openFileInFilesPage({ ...input, isFileTabsDisabled: false }),
    ).toBe(true);
    expect(
      useEditorStore.getState().openFiles.map((file) => file.path),
    ).toEqual(["other.ts", input.path]);
  });

  it.each([false, true])(
    "commits only B when responses finish in reverse order with tabs disabled %s",
    async (isFileTabsDisabled) => {
      let finishA: (value: Response) => void = () => {};
      let finishB: (value: Response) => void = () => {};
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise<Response>((resolve) => {
                finishA = resolve;
              }),
          )
          .mockImplementationOnce(
            () =>
              new Promise<Response>((resolve) => {
                finishB = resolve;
              }),
          ),
      );
      const openedPaths: string[] = [];
      const unsubscribe = useEditorStore.subscribe((state) => {
        openedPaths.push(...state.openFiles.map((file) => file.path));
      });
      const tokenA = setPendingNavigation("files-page", {
        uriKey: "a",
        lineNumber: 1,
        column: 1,
      });
      const a = openFileInFilesPage({
        ...input,
        path: "a.ts",
        isFileTabsDisabled,
        shouldCommit: () => isPendingNavigationCurrent("files-page", tokenA),
      });
      const tokenB = setPendingNavigation("files-page", {
        uriKey: "b",
        lineNumber: 1,
        column: 1,
      });
      const b = openFileInFilesPage({
        ...input,
        path: "b.ts",
        isFileTabsDisabled,
        shouldCommit: () => isPendingNavigationCurrent("files-page", tokenB),
      });

      finishB(response());
      expect(await b).toBe(true);
      finishA(response());
      expect(await a).toBe(false);

      unsubscribe();
      expect(openedPaths).not.toContain("a.ts");
      expect(useEditorStore.getState().activeFilePath).toBe("b.ts");
      expect(
        useEditorStore.getState().openFiles.map((file) => file.path),
      ).toEqual(["b.ts"]);
    },
  );

  it("opens images as a preview tab without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await openFileInFilesPage({ ...input, path: "assets/logo.png" }),
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({
        path: "assets/logo.png",
        name: "logo.png",
        content: "",
        language: IMAGE_LANGUAGE,
        isDirty: false,
      }),
    ]);
  });

  it("opens new files with their workspace", async () => {
    expect(await openFileInFilesPage(input)).toBe(true);
    expect(useEditorStore.getState().openFiles[0].workspaceId).toBe(
      input.workspaceId,
    );
  });
  it("replaces clean foreign tabs", async () => {
    seed(input.path, false, "foreign");
    const previous = useEditorStore.getState().openFiles[0];
    expect(await openFileInFilesPage(input)).toBe(true);
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "disk",
      workspaceId: input.workspaceId,
    });
    expect(useEditorStore.getState().openFiles[0].instanceId).not.toBe(
      previous.instanceId,
    );
  });
  it("activates foreign dirty tabs without fetching or closing others", async () => {
    seed(input.path, true, "foreign");
    const previous = useEditorStore.getState().openFiles[0];
    seed("other.ts");
    expect(await openFileInFilesPage(input)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles[0]).toBe(previous);
    expect(useEditorStore.getState().openFiles).toHaveLength(2);
    expect(useEditorStore.getState().activeFilePath).toBe(input.path);
    expect(toast.warning).toHaveBeenCalledWith(
      `${input.path} from another workspace has unsaved changes — save or close it first`,
    );
  });
  it("rechecks foreign dirty state after fetching", async () => {
    seed(input.path, false, "foreign");
    const instanceId = useEditorStore.getState().openFiles[0].instanceId;
    vi.mocked(fetch).mockImplementation(async () => {
      useEditorStore.getState().updateFileContent(input.path, "typed");
      return response();
    });
    expect(await openFileInFilesPage(input)).toBe(false);
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "typed",
      workspaceId: "foreign",
      instanceId,
    });
    expect(toast.warning).toHaveBeenCalled();
  });
  it("reuses a same-workspace tab without fetching", async () => {
    seed(input.path, true, input.workspaceId);
    vi.mocked(fetch).mockRejectedValue(new Error("must not fetch"));
    expect(await openFileInFilesPage(input)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles[0].content).toBe("unsaved");
  });
  it("never bulk closes clean tabs", async () => {
    seed("other.ts");
    const closeAll = vi.spyOn(useEditorStore.getState(), "closeAllFiles");
    const close = vi.spyOn(useEditorStore.getState(), "closeFile");
    expect(await openFileInFilesPage(input)).toBe(true);
    expect(close).toHaveBeenCalledWith("other.ts");
    expect(closeAll).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("changes nothing when an open is superseded", async () => {
    seed(input.path, true, input.workspaceId);
    const before = useEditorStore.getState();
    expect(
      await openFileInFilesPage({ ...input, shouldCommit: () => false }),
    ).toBe(false);
    expect(useEditorStore.getState()).toBe(before);
  });
});
