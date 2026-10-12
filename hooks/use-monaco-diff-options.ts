import { useMemo } from "react";
import type { editor } from "monaco-editor";
import { MONACO_FONT_FAMILY } from "@/lib/editor/monaco-themes";
import { WRAPPED_DIFF_EDITOR_OPTIONS } from "@/lib/editor/monaco-diff-options";

export function useMonacoDiffOptions({
  fontSize,
  renderSideBySide,
  readOnly,
  isReview,
}: {
  readonly fontSize: number;
  readonly renderSideBySide: boolean;
  readonly readOnly: boolean;
  readonly isReview: boolean;
}): editor.IDiffEditorConstructionOptions {
  return useMemo(
    () => ({
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
      fontFamily: MONACO_FONT_FAMILY,
      fontLigatures: false,
      ...WRAPPED_DIFF_EDITOR_OPTIONS,
      renderSideBySide,
      hideUnchangedRegions: { enabled: true },
      renderIndicators: true,
      renderMarginRevertIcon: isReview,
      originalEditable: false,
      readOnly,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: "on",
      ...(isReview ? { renderLineHighlight: "line" as const } : {}),
      automaticLayout: true,
      glyphMargin: true,
      folding: true,
      smoothScrolling: true,
      padding: { top: 8 },
    }),
    [fontSize, renderSideBySide, readOnly, isReview],
  );
}
