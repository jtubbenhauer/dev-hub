import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGitFolderGrouping } from "@/hooks/use-git-folder-grouping";

const GROUP_KEY = "dev-hub:git-group-by-folder";
const collapsedKey = (workspaceId: string) =>
  `dev-hub:git-collapsed-folders:${workspaceId}`;

// Renders the hook and records every render's values so we can assert on the
// first (pre-effect, SSR-stable) render distinctly from the post-effect render.
function renderWithHistory(workspaceId: string) {
  const renders: Array<{ grouped: boolean; collapsed: string[] }> = [];
  const view = renderHook(
    ({ workspaceId }: { workspaceId: string }) => {
      const hook = useGitFolderGrouping(workspaceId);
      renders.push({
        grouped: hook.isGroupedByFolder,
        collapsed: [...hook.collapsedFolders].sort(),
      });
      return hook;
    },
    { initialProps: { workspaceId } },
  );
  return { ...view, renders };
}

describe("useGitFolderGrouping", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hydration safety: first render returns defaults, effect applies stored values", () => {
    localStorage.setItem(GROUP_KEY, "false");
    localStorage.setItem(collapsedKey("ws1"), JSON.stringify(["a", "b"]));

    const { renders } = renderWithHistory("ws1");

    // First render must be the SSR-stable defaults regardless of storage.
    expect(renders[0]).toEqual({ grouped: true, collapsed: [] });

    // After mount effects, stored values are reflected.
    expect(renders[renders.length - 1]).toEqual({
      grouped: false,
      collapsed: ["a", "b"],
    });
  });

  it("defaults to grouped ON with an empty collapsed set when nothing is stored", () => {
    const { result } = renderHook(() => useGitFolderGrouping("ws1"));

    expect(result.current.isGroupedByFolder).toBe(true);
    expect([...result.current.collapsedFolders]).toEqual([]);
  });

  it("toggleGroupedByFolder flips state and persists to localStorage", () => {
    const { result } = renderHook(() => useGitFolderGrouping("ws1"));

    expect(result.current.isGroupedByFolder).toBe(true);

    act(() => {
      result.current.toggleGroupedByFolder();
    });

    expect(result.current.isGroupedByFolder).toBe(false);
    expect(localStorage.getItem(GROUP_KEY)).toBe("false");

    act(() => {
      result.current.toggleGroupedByFolder();
    });

    expect(result.current.isGroupedByFolder).toBe(true);
    expect(localStorage.getItem(GROUP_KEY)).toBe("true");
  });

  it("toggleFolder persists and keeps collapsed sets isolated between workspaces", () => {
    const { result } = renderHook(() => useGitFolderGrouping("ws1"));

    act(() => {
      result.current.toggleFolder("src");
    });

    expect([...result.current.collapsedFolders]).toEqual(["src"]);
    expect(JSON.parse(localStorage.getItem(collapsedKey("ws1"))!)).toEqual([
      "src",
    ]);
    // The other workspace's key was never written.
    expect(localStorage.getItem(collapsedKey("ws2"))).toBeNull();

    act(() => {
      result.current.toggleFolder("src");
    });

    expect([...result.current.collapsedFolders]).toEqual([]);
    expect(JSON.parse(localStorage.getItem(collapsedKey("ws1"))!)).toEqual([]);
  });

  it("malformed stored JSON falls back to an empty collapsed set", () => {
    localStorage.setItem(collapsedKey("ws1"), "{not valid json");

    const { result } = renderHook(() => useGitFolderGrouping("ws1"));

    expect([...result.current.collapsedFolders]).toEqual([]);
  });

  it("stored JSON that parses but is not a string array falls back to empty", () => {
    localStorage.setItem(collapsedKey("ws1"), "123");
    const { result: numberResult } = renderHook(() =>
      useGitFolderGrouping("ws1"),
    );
    expect([...numberResult.current.collapsedFolders]).toEqual([]);

    localStorage.setItem(collapsedKey("ws2"), '{"a":1}');
    const { result: objectResult } = renderHook(() =>
      useGitFolderGrouping("ws2"),
    );
    expect([...objectResult.current.collapsedFolders]).toEqual([]);

    localStorage.setItem(collapsedKey("ws3"), JSON.stringify(["ok", 5]));
    const { result: mixedResult } = renderHook(() =>
      useGitFolderGrouping("ws3"),
    );
    expect([...mixedResult.current.collapsedFolders]).toEqual([]);
  });

  it("stale-overwrite race: switching workspace loads the new set without cross-writing either key", () => {
    localStorage.setItem(collapsedKey("ws1"), JSON.stringify(["ws1-folder"]));
    localStorage.setItem(collapsedKey("ws2"), JSON.stringify(["ws2-folder"]));

    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useGitFolderGrouping(workspaceId),
      { initialProps: { workspaceId: "ws1" } },
    );

    expect([...result.current.collapsedFolders]).toEqual(["ws1-folder"]);

    act(() => {
      rerender({ workspaceId: "ws2" });
    });

    expect([...result.current.collapsedFolders]).toEqual(["ws2-folder"]);

    // Neither key was overwritten by the switch.
    expect(JSON.parse(localStorage.getItem(collapsedKey("ws1"))!)).toEqual([
      "ws1-folder",
    ]);
    expect(JSON.parse(localStorage.getItem(collapsedKey("ws2"))!)).toEqual([
      "ws2-folder",
    ]);
  });
});
