import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorTabMetadataSelector } from "@/hooks/use-editor-tab-metadata";
import { useEditorStore } from "@/stores/editor-store";

afterEach(cleanup);

describe("tab metadata subscription", () => {
  it("does not render on content-only edits but updates dirty flags", () => {
    useEditorStore.setState({
      openFiles: [
        {
          path: "a.ts",
          name: "a.ts",
          language: "typescript",
          content: "base",
          originalContent: "base",
          isDirty: false,
        },
      ],
      activeFilePath: "a.ts",
    });
    const render = vi.fn();
    const { result } = renderHook(() => {
      const tabs = useEditorStore(useEditorTabMetadataSelector());
      render();
      return tabs;
    });
    act(() => useEditorStore.getState().updateFileContent("a.ts", "first"));
    expect(result.current[0].isDirty).toBe(true);
    const previous = result.current;
    render.mockClear();
    act(() => useEditorStore.getState().updateFileContent("a.ts", "second"));
    expect(render).not.toHaveBeenCalled();
    expect(result.current).toBe(previous);
    act(() => useEditorStore.getState().updateFileContent("a.ts", "base"));
    expect(result.current[0].isDirty).toBe(false);
  });
});
