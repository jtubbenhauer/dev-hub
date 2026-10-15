// allow: SIZE_OK — Todo 13 extends this lifecycle suite without changing its existing shared fake model.
import { useEffect, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor, IRange } from "monaco-editor";
import { MonacoEditor } from "@/components/editor/monaco-editor";
import type { EditorRevealRequest } from "@/stores/editor-store";

let mockCandidateUri: string | undefined;

const state = vi.hoisted(() => ({
  action: undefined as editor.IActionDescriptor | undefined,
  disposeAction: vi.fn(),
  getValue: vi.fn(),
  options: undefined as editor.IStandaloneEditorConstructionOptions | undefined,
  value: "",
  isCodeLensEnabled: false,
  isMinimapEnabled: true,
  mountOverride:
    vi.fn<(mount: (instance: unknown, monaco: unknown) => void) => boolean>(),
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
      const { onMount } = props;
      useEffect(() => {
        if (state.mountOverride(onMount)) return;
        const onDispose = new Set<() => void>();
        onMount(
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
      }, [onMount]);
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
vi.mock("@/hooks/use-lsp-candidate-uri", () => ({
  useLspCandidateUri: () => mockCandidateUri,
}));
vi.mock("@/lib/lsp/client/builtin-typescript", () => ({
  trackBuiltinTs: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.isCodeLensEnabled = false;
  state.isMinimapEnabled = true;
  state.mountOverride.mockReset();
  mockCandidateUri = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Monaco search reveal lifecycle", () => {
  const request: EditorRevealRequest = {
    id: 1,
    workspaceId: "ws",
    path: "src/a.ts",
    lineNumber: 2,
    startColumn: 3,
    endColumn: 9,
    startByteColumn: 3,
    lineSha256: "a".repeat(64),
  };
  const props = {
    content: "first\na needle",
    language: "typescript",
    onChange: vi.fn(),
  };
  const requestedRange = {
    startLineNumber: 2,
    startColumn: 3,
    endLineNumber: 2,
    endColumn: 9,
  };

  function environment() {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const createModel = (uri: string) => ({
      uri: { toString: () => uri },
      validateRange: vi.fn((range: IRange) => ({
        ...range,
        endColumn: Math.min(range.endColumn, 8),
      })),
    });
    let model = createModel("inmemory://initial");
    const modelListeners = new Set<() => void>();
    const cursorListeners = new Set<(event: { source: string }) => void>();
    const modelDispose = vi.fn();
    const cursorDispose = vi.fn();
    const instance = {
      getModel: () => model,
      setSelection: vi.fn((_range: IRange) => {
        for (const listener of cursorListeners) listener({ source: "api" });
      }),
      revealRangeInCenter: vi.fn(),
      focus: vi.fn(),
      getValue: vi.fn(),
      createDecorationsCollection: () => ({ clear: vi.fn(), set: vi.fn() }),
      addAction: () => ({ dispose: vi.fn() }),
      onDidDispose: () => ({ dispose: vi.fn() }),
      onDidChangeModel: (listener: () => void) => {
        modelListeners.add(listener);
        return {
          dispose: () => {
            modelListeners.delete(listener);
            modelDispose();
          },
        };
      },
      onDidChangeCursorSelection: (
        listener: (event: { source: string }) => void,
      ) => {
        cursorListeners.add(listener);
        return {
          dispose: () => {
            cursorListeners.delete(listener);
            cursorDispose();
          },
        };
      },
    };
    let mount: ((instance: unknown, monaco: unknown) => void) | undefined;
    state.mountOverride.mockImplementation((callback) => {
      mount = callback;
      return true;
    });
    return {
      instance,
      modelDispose,
      cursorDispose,
      frames,
      mount: () =>
        act(() =>
          mount?.(instance, {
            KeyMod: { CtrlCmd: 2048 },
            KeyCode: { KeyS: 49 },
          }),
        ),
      changeModel: (uri: string) => {
        model = createModel(uri);
        act(() => {
          for (const listener of modelListeners) listener();
        });
        return model;
      },
      moveCursor: (source: string) =>
        act(() => {
          for (const listener of cursorListeners) listener({ source });
        }),
      flushFrames: () =>
        act(() => {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(0);
        }),
    };
  }

  it("selects the validated range once when ready without an LSP candidate", () => {
    // Given
    const fixture = environment();
    const handled = vi.fn();
    render(
      <MonacoEditor
        {...props}
        revealRequest={request}
        onRevealHandled={handled}
      />,
    );
    expect(fixture.instance.setSelection).not.toHaveBeenCalled();
    expect(handled).not.toHaveBeenCalled();
    // When
    fixture.mount();
    // Then
    expect(fixture.instance.getModel().validateRange).toHaveBeenCalledWith(
      requestedRange,
    );
    expect(fixture.instance.setSelection).toHaveBeenCalledExactlyOnceWith({
      ...requestedRange,
      endColumn: 8,
    });
    expect(fixture.instance.revealRangeInCenter).toHaveBeenCalledWith({
      ...requestedRange,
      endColumn: 8,
    });
    expect(fixture.instance.focus).toHaveBeenCalledOnce();
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
  });

  it("waits indefinitely and reapplies after view restore when LSP ownership arrives late", () => {
    // Given
    const fixture = environment();
    mockCandidateUri = "file:///ws/src/a.ts";
    const handled = vi.fn();
    function Parent() {
      const [pending, setPending] = useState<EditorRevealRequest | null>(
        request,
      );
      return (
        <MonacoEditor
          {...props}
          revealRequest={pending}
          onRevealHandled={(id) => {
            handled(id);
            setPending(null);
          }}
        />
      );
    }
    render(<Parent />);
    fixture.mount();
    expect(fixture.instance.setSelection).toHaveBeenCalledTimes(1);
    expect(handled).not.toHaveBeenCalled();
    const intermediate = fixture.changeModel("inmemory://intermediate");
    expect(intermediate.validateRange).not.toHaveBeenCalled();
    fixture.flushFrames();
    expect(intermediate.validateRange).toHaveBeenCalledWith(requestedRange);
    expect(fixture.instance.setSelection).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(5000));
    expect(handled).not.toHaveBeenCalled();
    // When
    const finalModel = fixture.changeModel("file:///ws/src/a.ts");
    expect(handled).not.toHaveBeenCalled();
    fixture.flushFrames();
    // Then
    expect(finalModel.validateRange).toHaveBeenCalledWith(requestedRange);
    expect(fixture.instance.setSelection).toHaveBeenCalledTimes(3);
    expect(fixture.instance.setSelection).toHaveBeenLastCalledWith({
      ...requestedRange,
      endColumn: 8,
    });
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
    expect(fixture.modelDispose).toHaveBeenCalled();
    expect(fixture.cursorDispose).toHaveBeenCalled();
  });

  it("stops restoring selection when the user moves the cursor before the swap", () => {
    // Given
    const fixture = environment();
    mockCandidateUri = "file:///ws/src/a.ts";
    const handled = vi.fn();
    render(
      <MonacoEditor
        {...props}
        revealRequest={request}
        onRevealHandled={handled}
      />,
    );
    fixture.mount();
    // When
    fixture.moveCursor("mouse");
    fixture.moveCursor("keyboard");
    fixture.changeModel("file:///ws/src/a.ts");
    fixture.flushFrames();
    // Then
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
    expect(fixture.instance.setSelection).toHaveBeenCalledTimes(1);
    expect(fixture.modelDispose).toHaveBeenCalledOnce();
    expect(fixture.cursorDispose).toHaveBeenCalledOnce();
  });

  it("disposes without acknowledgement when replaced or unmounted before the swap", () => {
    // Given
    const fixture = environment();
    mockCandidateUri = "file:///ws/src/a.ts";
    const handled = vi.fn();
    const view = render(
      <MonacoEditor
        {...props}
        revealRequest={request}
        onRevealHandled={handled}
      />,
    );
    fixture.mount();
    fixture.changeModel("inmemory://queued");
    // When
    view.rerender(
      <MonacoEditor
        {...props}
        revealRequest={{ ...request, id: 2 }}
        onRevealHandled={handled}
      />,
    );
    // Then
    expect(fixture.modelDispose).toHaveBeenCalledOnce();
    expect(fixture.cursorDispose).toHaveBeenCalledOnce();
    expect(fixture.frames.size).toBe(0);
    expect(handled).not.toHaveBeenCalled();
    fixture.changeModel("inmemory://queued-again");
    view.unmount();
    expect(fixture.modelDispose).toHaveBeenCalledTimes(2);
    expect(fixture.cursorDispose).toHaveBeenCalledTimes(2);
    expect(fixture.frames.size).toBe(0);
    expect(handled).not.toHaveBeenCalled();
  });
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
