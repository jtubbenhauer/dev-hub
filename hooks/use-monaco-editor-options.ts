import { useMemo } from "react";
import type { editor } from "monaco-editor";
import { MONACO_FONT_FAMILY } from "@/lib/editor/monaco-themes";

export function useMonacoEditorOptions({
  fontSize,
  tabSize,
  isMobile,
  isCommentMode,
  modelPath,
  isCodeLensEnabled,
  isMinimapEnabled,
}: {
  readonly fontSize: number;
  readonly tabSize: number;
  readonly isMobile: boolean;
  readonly isCommentMode: boolean;
  readonly modelPath: string | undefined;
  readonly isCodeLensEnabled: boolean;
  readonly isMinimapEnabled: boolean;
}): editor.IStandaloneEditorConstructionOptions {
  const isAttached = modelPath !== undefined;
  return useMemo(
    () => ({
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
      fontFamily: MONACO_FONT_FAMILY,
      fontLigatures: false,
      tabSize,
      minimap: {
        enabled: !isMobile && isMinimapEnabled,
        renderCharacters: false,
      },
      codeLens: isCodeLensEnabled,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      lineNumbers: "on",
      renderLineHighlight: "line",
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      padding: { top: 8 },
      folding: true,
      foldingStrategy: isAttached ? "auto" : "indentation",
      stickyScroll: { defaultModel: "indentationModel" },
      glyphMargin: isCommentMode,
      suggestOnTriggerCharacters: true,
      quickSuggestions: { other: true, comments: false, strings: false },
    }),
    [
      fontSize,
      tabSize,
      isMobile,
      isCommentMode,
      isAttached,
      isCodeLensEnabled,
      isMinimapEnabled,
    ],
  );
}
