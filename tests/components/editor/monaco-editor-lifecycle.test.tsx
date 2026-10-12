import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { MonacoEditor } from "@/components/editor/monaco-editor";

const state = vi.hoisted(() => ({
  action: undefined as editor.IActionDescriptor | undefined,
  disposeAction: vi.fn(),
  getValue: vi.fn(),
  options: undefined as editor.IStandaloneEditorConstructionOptions | undefined,
  value: "",
  isCodeLensEnabled: false,
  isMinimapEnabled: true,
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Editor(props: {
      onMount: (instance: unknown, monaco: unknown) => void;
      options: editor.IStandaloneEditorConstructionOptions;
      value: string;
    }) {
      state.options = props.options;
      state.value = props.value;
      useEffect(() => {
        const onDispose = new Set<() => void>();
        props.onMount(
          {
            getValue: state.getValue,
            getModel: () => null,
            createDecorationsCollection: () => ({
              clear: vi.fn(),
              set: vi.fn(),
            }),
            addAction: (action: editor.IActionDescriptor) => {
              state.action = action;
              return { dispose: state.disposeAction };
            },
            onDidDispose: (callback: () => void) => {
              onDispose.add(callback);
              return { dispose: () => onDispose.delete(callback) };
            },
          },
          { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 } },
        );
        return () => {
          for (const dispose of onDispose) dispose();
        };
      }, []);
      return null;
    },
}));
vi.mock("@/hooks/use-settings", () => ({
  useFontSizeSetting: () => ({ fontSize: 14 }),
  useMobileFontSizeSetting: () => ({ mobileFontSize: 12 }),
  useTabSizeSetting: () => ({ tabSize: 2 }),
  useLspEnabledSetting: () => ({ isLspEnabled: false, isLoading: false }),
  useCodeLensSetting: () => ({
    isCodeLensEnabled: state.isCodeLensEnabled,
    isLoading: false,
  }),
  useMinimapSetting: () => ({
    isMinimapEnabled: state.isMinimapEnabled,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "system", resolvedMode: "dark" }),
}));
vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: [] }),
  useCreateFileComment: () => ({ mutate: vi.fn() }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-monaco-diagnostic-markers", () => ({
  useMonacoDiagnosticMarkers: vi.fn(),
}));
vi.mock("@/hooks/use-lsp-editor-attachment", () => ({
  useLspEditorAttachment: () => undefined,
}));
vi.mock("@/lib/lsp/client/builtin-typescript", () => ({
  trackBuiltinTs: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.isCodeLensEnabled = false;
  state.isMinimapEnabled = true;
});

describe("Monaco editor integration", () => {
  it("routes the save action to the current file and disposes on unmount", () => {
    const saveA = vi.fn();
    const saveB = vi.fn();
    const onChange = vi.fn();
    const view = render(
      <MonacoEditor
        content="A"
        language="typescript"
        onChange={onChange}
        onSave={saveA}
      />,
    );
    view.rerender(
      <MonacoEditor
        content="B"
        language="typescript"
        onChange={onChange}
        onSave={saveB}
      />,
    );
    act(() => Reflect.apply(state.action?.run ?? (() => {}), undefined, []));
    expect(saveA).not.toHaveBeenCalled();
    expect(saveB).toHaveBeenCalledOnce();
    view.unmount();
    expect(state.disposeAction).toHaveBeenCalledOnce();
  });
  it("forwards external content through the controlled value without another getValue or option change", () => {
    const onChange = vi.fn();
    const view = render(
      <MonacoEditor
        content="before"
        language="typescript"
        onChange={onChange}
      />,
    );
    const options = state.options;
    view.rerender(
      <MonacoEditor
        content="disk edit"
        language="typescript"
        onChange={onChange}
      />,
    );
    expect(state.value).toBe("disk edit");
    expect(state.options).toBe(options);
    expect(state.getValue).not.toHaveBeenCalled();
  });
  it("passes the code lens and minimap settings into the editor options", () => {
    const onChange = vi.fn();
    const view = render(
      <MonacoEditor content="a" language="typescript" onChange={onChange} />,
    );
    expect(state.options?.codeLens).toBe(false);
    expect(state.options?.minimap?.enabled).toBe(true);
    state.isCodeLensEnabled = true;
    state.isMinimapEnabled = false;
    view.rerender(
      <MonacoEditor content="a" language="typescript" onChange={onChange} />,
    );
    expect(state.options?.codeLens).toBe(true);
    expect(state.options?.minimap?.enabled).toBe(false);
  });
});
