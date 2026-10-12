import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMonacoEditorOptions } from "@/hooks/use-monaco-editor-options";

interface OptionInputs {
  isMobile: boolean;
  isCodeLensEnabled: boolean;
  isMinimapEnabled: boolean;
}

const DEFAULT_INPUTS: OptionInputs = {
  isMobile: false,
  isCodeLensEnabled: false,
  isMinimapEnabled: true,
};

function renderOptions(initialInputs: Partial<OptionInputs> = {}) {
  return renderHook(
    (inputs: OptionInputs) =>
      useMonacoEditorOptions({
        fontSize: 14,
        tabSize: 2,
        isCommentMode: false,
        modelPath: undefined,
        ...inputs,
      }),
    { initialProps: { ...DEFAULT_INPUTS, ...initialInputs } },
  );
}

describe("Monaco options identity", () => {
  it("keeps options stable on unrelated renders and changes folding on attach/detach", () => {
    const { result, rerender } = renderHook(
      ({ modelPath }) =>
        useMonacoEditorOptions({
          fontSize: 14,
          tabSize: 2,
          isMobile: false,
          isCommentMode: true,
          modelPath,
          isCodeLensEnabled: false,
          isMinimapEnabled: true,
        }),
      { initialProps: { modelPath: undefined as string | undefined } },
    );
    const detached = result.current;
    expect(detached.foldingStrategy).toBe("indentation");
    expect(detached.minimap).toEqual({
      enabled: true,
      renderCharacters: false,
    });
    rerender({ modelPath: undefined });
    expect(result.current).toBe(detached);
    rerender({ modelPath: "file:///workspace/a.ts" });
    const attached = result.current;
    expect(attached.foldingStrategy).toBe("auto");
    rerender({ modelPath: "file:///workspace/a.ts" });
    expect(result.current).toBe(attached);
    rerender({ modelPath: undefined });
    expect(result.current.foldingStrategy).toBe("indentation");
  });
});

describe("Monaco code lens and minimap options", () => {
  it("disables code lens and shows the minimap with the default inputs", () => {
    const { result } = renderOptions();
    expect(result.current.codeLens).toBe(false);
    expect(result.current.minimap).toEqual({
      enabled: true,
      renderCharacters: false,
    });
  });

  it("enables code lens when the setting is on", () => {
    const { result } = renderOptions({ isCodeLensEnabled: true });
    expect(result.current.codeLens).toBe(true);
  });

  it("hides the minimap when the setting is off", () => {
    const { result } = renderOptions({ isMinimapEnabled: false });
    expect(result.current.minimap?.enabled).toBe(false);
  });

  it("hides the minimap on mobile even when the setting is on", () => {
    const { result } = renderOptions({
      isMobile: true,
      isMinimapEnabled: true,
    });
    expect(result.current.minimap?.enabled).toBe(false);
  });

  it("keeps identity for unchanged inputs and changes it when a setting changes", () => {
    const { result, rerender } = renderOptions();
    const initial = result.current;
    rerender({ ...DEFAULT_INPUTS });
    expect(result.current).toBe(initial);

    rerender({ ...DEFAULT_INPUTS, isCodeLensEnabled: true });
    const withCodeLens = result.current;
    expect(withCodeLens).not.toBe(initial);
    expect(withCodeLens.codeLens).toBe(true);
    rerender({ ...DEFAULT_INPUTS, isCodeLensEnabled: true });
    expect(result.current).toBe(withCodeLens);

    rerender({
      ...DEFAULT_INPUTS,
      isCodeLensEnabled: true,
      isMinimapEnabled: false,
    });
    expect(result.current).not.toBe(withCodeLens);
    expect(result.current.minimap?.enabled).toBe(false);
  });
});

describe("Monaco sticky scroll options", () => {
  it("uses the indentation model so sticky scroll does not request document symbols", () => {
    const { result } = renderOptions();
    expect(result.current.stickyScroll?.defaultModel).toBe("indentationModel");
    expect(result.current.stickyScroll?.enabled).toBeUndefined();
  });

  it("keeps the sticky scroll model and options identity for unchanged inputs", () => {
    const { result, rerender } = renderOptions();
    const initial = result.current;
    const initialStickyScroll = initial.stickyScroll;
    rerender({ ...DEFAULT_INPUTS });
    expect(result.current).toBe(initial);
    expect(result.current.stickyScroll).toBe(initialStickyScroll);

    rerender({ ...DEFAULT_INPUTS, isMinimapEnabled: false });
    expect(result.current).not.toBe(initial);
    expect(result.current.stickyScroll?.defaultModel).toBe("indentationModel");
  });
});
