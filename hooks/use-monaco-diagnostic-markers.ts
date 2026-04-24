import { useEffect } from "react";
import type { editor } from "monaco-editor";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { mapToMonacoMarker } from "@/lib/editor/diagnostics";
import type { Diagnostic } from "@/types/diagnostics";

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

export function useMonacoDiagnosticMarkers(
  monacoRef: React.RefObject<typeof import("monaco-editor") | null>,
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>,
  workspaceId: string | undefined,
  filePath: string | undefined,
  isEditorReady: boolean,
) {
  const diagnostics = useDiagnosticsStore((s) =>
    workspaceId && filePath
      ? (s.diagnosticsByFile.get(`${workspaceId}:${filePath}`) ??
        EMPTY_DIAGNOSTICS)
      : EMPTY_DIAGNOSTICS,
  );

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
}
