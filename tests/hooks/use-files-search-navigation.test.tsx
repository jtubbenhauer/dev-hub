// allow: SIZE_OK — Todo 14 requires this single navigation acceptance suite; shared fixtures and table cases keep its race scenarios together.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useFilesSearchNavigation } from "@/hooks/use-files-search-navigation";
import { buildMatch } from "@/packages/shared/src/content-search/preview";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { OpenFile } from "@/types";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
const line = "é needle here";
const content = `first\n${line}`;
const match = buildMatch({
  line,
  lineNumber: 2,
  start: 2,
  end: 8,
  lineSha256: "0".repeat(64),
});
const changedMessage =
  "a.ts changed since the search ran. Search again to update the results.";
const dirtyMessage =
  "a.ts has unsaved changes, so the search match can't be selected. Save the file and search again.";
const input = {
  workspaceId: "ws-1",
  isFileTabsDisabled: false,
  isMobile: false,
};
const fetchMock = vi.fn<typeof fetch>();

function seedTab(overrides: Partial<OpenFile> = {}) {
  const tab: OpenFile = {
    workspaceId: "ws-1",
    path: "a.ts",
    name: "a.ts",
    language: "typescript",
    content,
    originalContent: content,
    isDirty: false,
    ...overrides,
  };
  useEditorStore.setState({ openFiles: [tab], activeFilePath: tab.path });
  return tab;
}

function diskResponse(text = content) {
  return Response.json({ content: text, language: "typescript" });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset().mockImplementation(async () => diskResponse());
  vi.stubGlobal("fetch", fetchMock);
  useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
  useContentSearchStore.setState({ pendingFocus: false });
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    pendingReveal: null,
    markdownPreviewPath: null,
    csvPreviewPath: null,
    workspaceFileStates: {},
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFilesSearchNavigation", () => {
  it.each([true, false])(
    "opens the sheet only on mobile when focus is requested (mobile=%s)",
    (isMobile) => {
      // Given
      const { result } = renderHook(() =>
        useFilesSearchNavigation({ ...input, isMobile }),
      );
      // When
      act(() => useContentSearchStore.getState().requestOpen(null));
      // Then
      expect(result.current.isMobileSheetOpen).toBe(isMobile);
    },
  );

  it("activates and reveals only B when opens resolve in reverse order", async () => {
    // Given
    const first = deferred<Response>();
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("path=a.ts") ? first.promise : diskResponse(),
    );
    const reveal = vi.spyOn(useEditorStore.getState(), "requestReveal");
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    const openingA = result.current.handleOpenMatch("a.ts", match);
    await act(() => result.current.handleOpenMatch("b.ts", match));
    await act(async () => {
      first.resolve(diskResponse());
      await openingA;
    });
    // Then
    expect(useEditorStore.getState().activeFilePath).toBe("b.ts");
    expect(useEditorStore.getState().openFiles.map((tab) => tab.path)).toEqual([
      "b.ts",
    ]);
    expect(reveal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: "b.ts" }),
    );
  });

  it.each([false, true])(
    "drops an in-flight read after a workspace switch (verification=%s)",
    async (isVerification) => {
      // Given
      const tab = isVerification ? seedTab() : undefined;
      const pending = deferred<Response>();
      fetchMock.mockImplementation(() => pending.promise);
      const { result, rerender } = renderHook(
        (props) => useFilesSearchNavigation(props),
        { initialProps: input },
      );
      // When
      const opening = result.current.handleOpenMatch("a.ts", match);
      await act(async () => {});
      act(() => useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" }));
      rerender({ ...input, workspaceId: "ws-2" });
      await act(async () => {
        pending.resolve(diskResponse("different disk text"));
        await opening;
      });
      // Then
      expect(useEditorStore.getState().pendingReveal).toBeNull();
      expect(useEditorStore.getState().openFiles).toEqual(tab ? [tab] : []);
    },
  );

  it("preserves edits and warns when the tab is dirty", async () => {
    // Given
    const tab = seedTab({ content: `inserted\n${content}`, isDirty: true });
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    await act(() => result.current.handleOpenMatch("a.ts", match));
    // Then
    expect(useEditorStore.getState().openFiles).toEqual([tab]);
    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(dirtyMessage);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips reveal when logo.svg is a binary-preview tab", async () => {
    // Given: SVG normally opens as source; an existing image-language tab exercises the preview guard.
    seedTab({ path: "logo.svg", name: "logo.svg", language: "image" });
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    await act(() => result.current.handleOpenMatch("logo.svg", match));
    // Then
    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ws-1", undefined])(
    "refreshes and adopts a stale clean tab when workspaceId=%s",
    async (workspaceId) => {
      // Given
      seedTab({
        content: "old text",
        originalContent: "old text",
        workspaceId,
      });
      const { result } = renderHook(() => useFilesSearchNavigation(input));
      // When
      await act(() => result.current.handleOpenMatch("a.ts", match));
      // Then
      expect(useEditorStore.getState().openFiles[0]).toMatchObject({
        content,
        originalContent: content,
        workspaceId: "ws-1",
        isDirty: false,
      });
      expect(useEditorStore.getState().pendingReveal).toMatchObject({
        path: "a.ts",
        lineNumber: 2,
      });
    },
  );

  it.each([content, "already stale", null])(
    "refreshes without revealing when disk lost the match (tab=%s)",
    async (tabContent) => {
      // Given
      if (tabContent !== null)
        seedTab({ content: tabContent, originalContent: tabContent });
      fetchMock.mockImplementation(async () => diskResponse("first\nno match"));
      const { result } = renderHook(() => useFilesSearchNavigation(input));
      // When
      await act(() => result.current.handleOpenMatch("a.ts", match));
      // Then
      expect(useEditorStore.getState().openFiles[0]?.content).toBe(
        "first\nno match",
      );
      expect(useEditorStore.getState().pendingReveal).toBeNull();
      expect(toast.info).toHaveBeenCalledWith(changedMessage);
    },
  );

  it("rejects a long match when only character 400 changed", async () => {
    // Given
    const searchedLine = "a".repeat(500);
    const diskLine = `${"a".repeat(399)}b${"a".repeat(100)}`;
    const longMatch = buildMatch({
      line: searchedLine,
      lineNumber: 1,
      start: 0,
      end: 500,
      lineSha256: "0".repeat(64),
    });
    seedTab({ content: diskLine, originalContent: diskLine });
    fetchMock.mockImplementation(async () => diskResponse(diskLine));
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    await act(() => result.current.handleOpenMatch("a.ts", longMatch));
    // Then
    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(changedMessage);
  });

  it("leaves A unchanged when its verification arrives after clicking B", async () => {
    // Given
    const verification = deferred<Response>();
    const verificationStarted = deferred<void>();
    let aReads = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("path=a.ts") && ++aReads === 2) {
        verificationStarted.resolve();
        return verification.promise;
      }
      return diskResponse();
    });
    const reveal = vi.spyOn(useEditorStore.getState(), "requestReveal");
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    const openingA = result.current.handleOpenMatch("a.ts", match);
    await verificationStarted.promise;
    await act(() => result.current.handleOpenMatch("b.ts", match));
    await act(async () => {
      verification.resolve(diskResponse("late change"));
      await openingA;
    });
    // Then
    expect(
      useEditorStore.getState().openFiles.find((tab) => tab.path === "a.ts")
        ?.content,
    ).toBe(content);
    expect(reveal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: "b.ts" }),
    );
  });

  it("reports a re-read failure when verification returns HTTP 500", async () => {
    // Given
    seedTab();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { result } = renderHook(() => useFilesSearchNavigation(input));
    // When
    await act(() => result.current.handleOpenMatch("a.ts", match));
    // Then
    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't re-read a.ts to check the search match. Try again.",
    );
  });

  it("preserves byte coordinates and closes the mobile sheet when revealing", async () => {
    // Given
    const { result } = renderHook(() =>
      useFilesSearchNavigation({ ...input, isMobile: true }),
    );
    act(() => result.current.setIsMobileSheetOpen(true));
    // When
    await act(() => result.current.handleOpenMatch("src/a.ts", match));
    // Then
    expect(useEditorStore.getState().pendingReveal).toMatchObject({
      workspaceId: "ws-1",
      path: "src/a.ts",
      lineNumber: 2,
      startColumn: 3,
      endColumn: 9,
      startByteColumn: match.startByteColumn,
      lineSha256: match.lineSha256,
    });
    expect(result.current.isMobileSheetOpen).toBe(false);
    expect(useEditorStore.getState().getExpandedPaths("ws-1").has("src")).toBe(
      true,
    );
  });
});
