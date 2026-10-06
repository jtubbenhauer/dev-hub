import { useEffect, useLayoutEffect, useRef } from "react";
import type { editor } from "monaco-editor";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { mapToMonacoMarker } from "@/lib/editor/diagnostics";
import type { Diagnostic } from "@/types/diagnostics";

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

function readStoredEslintDiagnostics(
  workspaceId: string | undefined,
  filePath: string | undefined,
): Diagnostic[] {
  if (!workspaceId || !filePath) return EMPTY_DIAGNOSTICS;
  return (
    useDiagnosticsStore
      .getState()
      .diagnosticsBySource.get(`${workspaceId}:${filePath}`)?.eslint ??
    EMPTY_DIAGNOSTICS
  );
}

export function useMonacoDiagnosticMarkers(
  monacoRef: React.RefObject<typeof import("monaco-editor") | null>,
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>,
  workspaceId: string | undefined,
  filePath: string | undefined,
  isEditorReady: boolean,
) {
  const diagnostics = useDiagnosticsStore((s) =>
    workspaceId && filePath
      ? (s.diagnosticsBySource.get(`${workspaceId}:${filePath}`)?.eslint ??
        EMPTY_DIAGNOSTICS)
      : EMPTY_DIAGNOSTICS,
  );

  const workspaceIdRef = useRef(workspaceId);
  const filePathRef = useRef(filePath);

  // Layout effect so the refs are current before the editor's child
  // component swaps models in its passive effects (child effects run first).
  useLayoutEffect(() => {
    workspaceIdRef.current = workspaceId;
    filePathRef.current = filePath;
  }, [workspaceId, filePath]);

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    const editorInstance = editorRef.current;
    if (!monacoInstance || !editorInstance || !isEditorReady) return;

    const model = editorInstance.getModel();
    if (!model || model.isDisposed()) return;

    const markers = diagnostics.map(mapToMonacoMarker);
    monacoInstance.editor.setModelMarkers(
      model,
      "eslint",
      markers as editor.IMarkerData[],
    );

    return () => {
      const m = editorInstance.getModel();
      if (m && !m.isDisposed()) {
        monacoInstance.editor.setModelMarkers(m, "eslint", []);
      }
    };
  }, [diagnostics, isEditorReady, monacoRef, editorRef]);

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    const editorInstance = editorRef.current;
    if (!monacoInstance || !editorInstance || !isEditorReady) return;

    const modelChangeSubscription = editorInstance.onDidChangeModel(() => {
      const newModel = editorInstance.getModel();
      if (!newModel || newModel.isDisposed()) return;
      const storedEslintDiagnostics = readStoredEslintDiagnostics(
        workspaceIdRef.current,
        filePathRef.current,
      );
      monacoInstance.editor.setModelMarkers(
        newModel,
        "eslint",
        storedEslintDiagnostics.map(mapToMonacoMarker) as editor.IMarkerData[],
      );
    });

    return () => modelChangeSubscription.dispose();
  }, [isEditorReady, monacoRef, editorRef]);
}
