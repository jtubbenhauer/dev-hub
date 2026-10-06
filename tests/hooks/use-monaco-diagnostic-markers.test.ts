import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { editor } from "monaco-editor";
import { useMonacoDiagnosticMarkers } from "@/hooks/use-monaco-diagnostic-markers";
import { mapToMonacoMarker } from "@/lib/editor/diagnostics";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { DiagnosticSeverity, type Diagnostic } from "@/types/diagnostics";

type MonacoNamespace = typeof import("monaco-editor");

interface FakeModel {
  readonly name: string;
  isDisposed: () => boolean;
}

function makeFakeModel(name: string): FakeModel {
  return { name, isDisposed: () => false };
}

function makeDiagnostic(message: string, source: string): Diagnostic {
  return {
    message,
    severity: DiagnosticSeverity.Error,
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
    source,
  };
}

function createFakeEditorEnvironment(initialModel: FakeModel) {
  let currentModel = initialModel;
  const modelChangeListeners = new Set<() => void>();
  const disposeSubscription = vi.fn();
  const setModelMarkers = vi.fn();

  const fakeEditor = {
    getModel: () => currentModel,
    onDidChangeModel: (listener: () => void) => {
      modelChangeListeners.add(listener);
      return {
        dispose: () => {
          disposeSubscription();
          modelChangeListeners.delete(listener);
        },
      };
    },
  };

  const switchModel = (nextModel: FakeModel) => {
    currentModel = nextModel;
    for (const listener of modelChangeListeners) listener();
  };

  const monacoRef = {
    current: { editor: { setModelMarkers } } as unknown as MonacoNamespace,
  };
  const editorRef = {
    current: fakeEditor as unknown as editor.IStandaloneCodeEditor,
  };

  return {
    monacoRef,
    editorRef,
    setModelMarkers,
    switchModel,
    disposeSubscription,
    listenerCount: () => modelChangeListeners.size,
  };
}

function lastMarkersFor(setModelMarkers: Mock, model: FakeModel) {
  const matchingCalls = setModelMarkers.mock.calls.filter(
    (call: unknown[]) => call[0] === model && call[1] === "eslint",
  );
  return matchingCalls.at(-1)?.[2];
}

describe("useMonacoDiagnosticMarkers", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAllDiagnostics();
  });

  it("passes only ESLint diagnostics to the eslint owner when TS diagnostics exist", () => {
    const eslintDiagnostic = makeDiagnostic("no-unused-vars", "eslint");
    const typescriptDiagnostic = makeDiagnostic("TS2322", "ts");
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws1", "src/a.ts", [eslintDiagnostic]);
    useDiagnosticsStore
      .getState()
      .setDiagnosticsForSource("ws1", "src/a.ts", "typescript", [
        typescriptDiagnostic,
      ]);
    const modelA = makeFakeModel("a");
    const environment = createFakeEditorEnvironment(modelA);

    renderHook(() =>
      useMonacoDiagnosticMarkers(
        environment.monacoRef,
        environment.editorRef,
        "ws1",
        "src/a.ts",
        true,
      ),
    );

    expect(lastMarkersFor(environment.setModelMarkers, modelA)).toEqual([
      mapToMonacoMarker(eslintDiagnostic),
    ]);
  });

  it("does not re-apply eslint markers when only the typescript source changes", () => {
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws1", "src/a.ts", [makeDiagnostic("lint", "eslint")]);
    const environment = createFakeEditorEnvironment(makeFakeModel("a"));
    renderHook(() =>
      useMonacoDiagnosticMarkers(
        environment.monacoRef,
        environment.editorRef,
        "ws1",
        "src/a.ts",
        true,
      ),
    );
    const callCountBefore = environment.setModelMarkers.mock.calls.length;

    act(() => {
      useDiagnosticsStore
        .getState()
        .setDiagnosticsForSource("ws1", "src/a.ts", "typescript", [
          makeDiagnostic("TS2322", "ts"),
        ]);
    });

    expect(environment.setModelMarkers.mock.calls.length).toBe(callCountBefore);
  });

  it("applies stored ESLint diagnostics to a newly switched model without a store change", () => {
    const eslintDiagnostic = makeDiagnostic("prefer-const", "eslint");
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws1", "src/b.ts", [eslintDiagnostic]);
    const environment = createFakeEditorEnvironment(makeFakeModel("a"));
    renderHook(() =>
      useMonacoDiagnosticMarkers(
        environment.monacoRef,
        environment.editorRef,
        "ws1",
        "src/b.ts",
        true,
      ),
    );
    const storeStateBefore = useDiagnosticsStore.getState();
    const modelB = makeFakeModel("b");

    act(() => {
      environment.switchModel(modelB);
    });

    expect(useDiagnosticsStore.getState()).toBe(storeStateBefore);
    expect(lastMarkersFor(environment.setModelMarkers, modelB)).toEqual([
      mapToMonacoMarker(eslintDiagnostic),
    ]);
  });

  it("uses the latest file path when the model switches after a rerender", () => {
    const fileBDiagnostic = makeDiagnostic("eqeqeq", "eslint");
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws1", "src/b.ts", [fileBDiagnostic]);
    const environment = createFakeEditorEnvironment(makeFakeModel("a"));
    const { rerender } = renderHook(
      ({ filePath }: { filePath: string }) =>
        useMonacoDiagnosticMarkers(
          environment.monacoRef,
          environment.editorRef,
          "ws1",
          filePath,
          true,
        ),
      { initialProps: { filePath: "src/a.ts" } },
    );
    rerender({ filePath: "src/b.ts" });
    const modelB = makeFakeModel("b");

    act(() => {
      environment.switchModel(modelB);
    });

    expect(lastMarkersFor(environment.setModelMarkers, modelB)).toEqual([
      mapToMonacoMarker(fileBDiagnostic),
    ]);
  });

  it("does not subscribe to model changes before the editor is ready", () => {
    const environment = createFakeEditorEnvironment(makeFakeModel("a"));

    renderHook(() =>
      useMonacoDiagnosticMarkers(
        environment.monacoRef,
        environment.editorRef,
        "ws1",
        "src/a.ts",
        false,
      ),
    );

    expect(environment.listenerCount()).toBe(0);
    expect(environment.setModelMarkers).not.toHaveBeenCalled();
  });

  it("disposes the model change subscription on unmount", () => {
    const environment = createFakeEditorEnvironment(makeFakeModel("a"));
    const { unmount } = renderHook(() =>
      useMonacoDiagnosticMarkers(
        environment.monacoRef,
        environment.editorRef,
        "ws1",
        "src/a.ts",
        true,
      ),
    );

    unmount();

    expect(environment.disposeSubscription).toHaveBeenCalledOnce();
    expect(environment.listenerCount()).toBe(0);
  });
});
