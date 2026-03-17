import type { editor } from "monaco-editor"

type MonacoThemeData = editor.IStandaloneThemeData

// ---------------------------------------------------------------------------
// Catppuccin Mocha
// ---------------------------------------------------------------------------
const catppuccinMocha: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "cdd6f4" },
    { token: "comment", foreground: "6c7086", fontStyle: "italic" },
    { token: "keyword", foreground: "cba6f7" },
    { token: "keyword.control", foreground: "cba6f7" },
    { token: "keyword.operator", foreground: "89dceb" },
    { token: "string", foreground: "a6e3a1" },
    { token: "string.escape", foreground: "f2cdcd" },
    { token: "number", foreground: "fab387" },
    { token: "constant", foreground: "fab387" },
    { token: "type", foreground: "f9e2af" },
    { token: "type.identifier", foreground: "f9e2af" },
    { token: "variable", foreground: "cdd6f4" },
    { token: "variable.predefined", foreground: "eba0ac" },
    { token: "function", foreground: "89b4fa" },
    { token: "tag", foreground: "cba6f7" },
    { token: "attribute.name", foreground: "f9e2af" },
    { token: "attribute.value", foreground: "a6e3a1" },
    { token: "delimiter", foreground: "9399b2" },
    { token: "operator", foreground: "89dceb" },
    { token: "regexp", foreground: "f5c2e7" },
    { token: "annotation", foreground: "f5c2e7" },
    { token: "meta", foreground: "f5c2e7" },
  ],
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editor.lineHighlightBackground": "#2a2b3d",
    "editor.selectionBackground": "#585b7066",
    "editor.inactiveSelectionBackground": "#585b7033",
    "editorCursor.foreground": "#f5e0dc",
    "editorLineNumber.foreground": "#6c7086",
    "editorLineNumber.activeForeground": "#cdd6f4",
    "editorGutter.background": "#1e1e2e",
    "editorBracketMatch.background": "#585b7044",
    "editorBracketMatch.border": "#585b70",
    "editorIndentGuide.background": "#45475a55",
    "editorIndentGuide.activeBackground": "#585b70",
    "editor.findMatchBackground": "#f9e2af33",
    "editor.findMatchHighlightBackground": "#f9e2af22",
    "editorWidget.background": "#181825",
    "editorWidget.border": "#313244",
    "input.background": "#313244",
    "input.border": "#45475a",
    "input.foreground": "#cdd6f4",
    "list.activeSelectionBackground": "#45475a",
    "list.hoverBackground": "#313244",
    "scrollbarSlider.background": "#585b7044",
    "scrollbarSlider.hoverBackground": "#585b7066",
    "scrollbarSlider.activeBackground": "#585b7088",
  },
}

// ---------------------------------------------------------------------------
// Catppuccin Macchiato
// ---------------------------------------------------------------------------
const catppuccinMacchiato: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "cad3f5" },
    { token: "comment", foreground: "6e738d", fontStyle: "italic" },
    { token: "keyword", foreground: "c6a0f6" },
    { token: "keyword.control", foreground: "c6a0f6" },
    { token: "keyword.operator", foreground: "8bd5ca" },
    { token: "string", foreground: "a6da95" },
    { token: "string.escape", foreground: "f0c6c6" },
    { token: "number", foreground: "f5a97f" },
    { token: "constant", foreground: "f5a97f" },
    { token: "type", foreground: "eed49f" },
    { token: "type.identifier", foreground: "eed49f" },
    { token: "variable", foreground: "cad3f5" },
    { token: "variable.predefined", foreground: "ee99a0" },
    { token: "function", foreground: "8aadf4" },
    { token: "tag", foreground: "c6a0f6" },
    { token: "attribute.name", foreground: "eed49f" },
    { token: "attribute.value", foreground: "a6da95" },
    { token: "delimiter", foreground: "939ab7" },
    { token: "operator", foreground: "8bd5ca" },
    { token: "regexp", foreground: "f5bde6" },
    { token: "annotation", foreground: "f5bde6" },
    { token: "meta", foreground: "f5bde6" },
  ],
  colors: {
    "editor.background": "#24273a",
    "editor.foreground": "#cad3f5",
    "editor.lineHighlightBackground": "#2e3248",
    "editor.selectionBackground": "#5b6078aa",
    "editor.inactiveSelectionBackground": "#5b607833",
    "editorCursor.foreground": "#f4dbd6",
    "editorLineNumber.foreground": "#6e738d",
    "editorLineNumber.activeForeground": "#cad3f5",
    "editorGutter.background": "#24273a",
    "editorBracketMatch.background": "#5b607844",
    "editorBracketMatch.border": "#5b6078",
    "editorIndentGuide.background": "#494d6455",
    "editorIndentGuide.activeBackground": "#5b6078",
    "editor.findMatchBackground": "#eed49f33",
    "editor.findMatchHighlightBackground": "#eed49f22",
    "editorWidget.background": "#1e2030",
    "editorWidget.border": "#363a4f",
    "input.background": "#363a4f",
    "input.border": "#494d64",
    "input.foreground": "#cad3f5",
    "list.activeSelectionBackground": "#494d64",
    "list.hoverBackground": "#363a4f",
    "scrollbarSlider.background": "#5b607844",
    "scrollbarSlider.hoverBackground": "#5b607866",
    "scrollbarSlider.activeBackground": "#5b607888",
  },
}

// ---------------------------------------------------------------------------
// Catppuccin Frappé
// ---------------------------------------------------------------------------
const catppuccinFrappe: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "c6d0f5" },
    { token: "comment", foreground: "737994", fontStyle: "italic" },
    { token: "keyword", foreground: "ca9ee6" },
    { token: "keyword.control", foreground: "ca9ee6" },
    { token: "keyword.operator", foreground: "81c8be" },
    { token: "string", foreground: "a6d189" },
    { token: "string.escape", foreground: "eebebe" },
    { token: "number", foreground: "ef9f76" },
    { token: "constant", foreground: "ef9f76" },
    { token: "type", foreground: "e5c890" },
    { token: "type.identifier", foreground: "e5c890" },
    { token: "variable", foreground: "c6d0f5" },
    { token: "variable.predefined", foreground: "ea999c" },
    { token: "function", foreground: "8caaee" },
    { token: "tag", foreground: "ca9ee6" },
    { token: "attribute.name", foreground: "e5c890" },
    { token: "attribute.value", foreground: "a6d189" },
    { token: "delimiter", foreground: "949cbb" },
    { token: "operator", foreground: "81c8be" },
    { token: "regexp", foreground: "f4b8e4" },
    { token: "annotation", foreground: "f4b8e4" },
    { token: "meta", foreground: "f4b8e4" },
  ],
  colors: {
    "editor.background": "#303446",
    "editor.foreground": "#c6d0f5",
    "editor.lineHighlightBackground": "#3a3e54",
    "editor.selectionBackground": "#626880aa",
    "editor.inactiveSelectionBackground": "#62688033",
    "editorCursor.foreground": "#f2d5cf",
    "editorLineNumber.foreground": "#737994",
    "editorLineNumber.activeForeground": "#c6d0f5",
    "editorGutter.background": "#303446",
    "editorBracketMatch.background": "#62688044",
    "editorBracketMatch.border": "#626880",
    "editorIndentGuide.background": "#51576d55",
    "editorIndentGuide.activeBackground": "#626880",
    "editor.findMatchBackground": "#e5c89033",
    "editor.findMatchHighlightBackground": "#e5c89022",
    "editorWidget.background": "#292c3c",
    "editorWidget.border": "#414559",
    "input.background": "#414559",
    "input.border": "#51576d",
    "input.foreground": "#c6d0f5",
    "list.activeSelectionBackground": "#51576d",
    "list.hoverBackground": "#414559",
    "scrollbarSlider.background": "#62688044",
    "scrollbarSlider.hoverBackground": "#62688066",
    "scrollbarSlider.activeBackground": "#62688088",
  },
}

// ---------------------------------------------------------------------------
// Catppuccin Latte
// ---------------------------------------------------------------------------
const catppuccinLatte: MonacoThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "", foreground: "4c4f69" },
    { token: "comment", foreground: "9ca0b0", fontStyle: "italic" },
    { token: "keyword", foreground: "8839ef" },
    { token: "keyword.control", foreground: "8839ef" },
    { token: "keyword.operator", foreground: "179299" },
    { token: "string", foreground: "40a02b" },
    { token: "string.escape", foreground: "dd7878" },
    { token: "number", foreground: "fe640b" },
    { token: "constant", foreground: "fe640b" },
    { token: "type", foreground: "df8e1d" },
    { token: "type.identifier", foreground: "df8e1d" },
    { token: "variable", foreground: "4c4f69" },
    { token: "variable.predefined", foreground: "d20f39" },
    { token: "function", foreground: "1e66f5" },
    { token: "tag", foreground: "8839ef" },
    { token: "attribute.name", foreground: "df8e1d" },
    { token: "attribute.value", foreground: "40a02b" },
    { token: "delimiter", foreground: "7c7f93" },
    { token: "operator", foreground: "179299" },
    { token: "regexp", foreground: "ea76cb" },
    { token: "annotation", foreground: "ea76cb" },
    { token: "meta", foreground: "ea76cb" },
  ],
  colors: {
    "editor.background": "#eff1f5",
    "editor.foreground": "#4c4f69",
    "editor.lineHighlightBackground": "#e6e9ef",
    "editor.selectionBackground": "#acb0be66",
    "editor.inactiveSelectionBackground": "#acb0be33",
    "editorCursor.foreground": "#dc8a78",
    "editorLineNumber.foreground": "#9ca0b0",
    "editorLineNumber.activeForeground": "#4c4f69",
    "editorGutter.background": "#eff1f5",
    "editorBracketMatch.background": "#acb0be44",
    "editorBracketMatch.border": "#acb0be",
    "editorIndentGuide.background": "#bcc0cc55",
    "editorIndentGuide.activeBackground": "#acb0be",
    "editor.findMatchBackground": "#df8e1d33",
    "editor.findMatchHighlightBackground": "#df8e1d22",
    "editorWidget.background": "#e6e9ef",
    "editorWidget.border": "#ccd0da",
    "input.background": "#ccd0da",
    "input.border": "#bcc0cc",
    "input.foreground": "#4c4f69",
    "list.activeSelectionBackground": "#bcc0cc",
    "list.hoverBackground": "#ccd0da",
    "scrollbarSlider.background": "#acb0be44",
    "scrollbarSlider.hoverBackground": "#acb0be66",
    "scrollbarSlider.activeBackground": "#acb0be88",
  },
}

// ---------------------------------------------------------------------------
// Dracula
// ---------------------------------------------------------------------------
const draculaTheme: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "f8f8f2" },
    { token: "comment", foreground: "6272a4", fontStyle: "italic" },
    { token: "keyword", foreground: "ff79c6" },
    { token: "keyword.control", foreground: "ff79c6" },
    { token: "keyword.operator", foreground: "ff79c6" },
    { token: "string", foreground: "f1fa8c" },
    { token: "string.escape", foreground: "ffb86c" },
    { token: "number", foreground: "bd93f9" },
    { token: "constant", foreground: "bd93f9" },
    { token: "type", foreground: "8be9fd", fontStyle: "italic" },
    { token: "type.identifier", foreground: "8be9fd", fontStyle: "italic" },
    { token: "variable", foreground: "f8f8f2" },
    { token: "variable.predefined", foreground: "bd93f9" },
    { token: "function", foreground: "50fa7b" },
    { token: "tag", foreground: "ff79c6" },
    { token: "attribute.name", foreground: "50fa7b" },
    { token: "attribute.value", foreground: "f1fa8c" },
    { token: "delimiter", foreground: "f8f8f2" },
    { token: "operator", foreground: "ff79c6" },
    { token: "regexp", foreground: "ff5555" },
    { token: "annotation", foreground: "8be9fd" },
    { token: "meta", foreground: "f8f8f2" },
  ],
  colors: {
    "editor.background": "#282a36",
    "editor.foreground": "#f8f8f2",
    "editor.lineHighlightBackground": "#44475a75",
    "editor.selectionBackground": "#44475a",
    "editor.inactiveSelectionBackground": "#44475a55",
    "editorCursor.foreground": "#f8f8f2",
    "editorLineNumber.foreground": "#6272a4",
    "editorLineNumber.activeForeground": "#f8f8f2",
    "editorGutter.background": "#282a36",
    "editorBracketMatch.background": "#44475a",
    "editorBracketMatch.border": "#6272a4",
    "editorIndentGuide.background": "#44475a55",
    "editorIndentGuide.activeBackground": "#6272a4",
    "editor.findMatchBackground": "#ffb86c44",
    "editor.findMatchHighlightBackground": "#ffb86c22",
    "editorWidget.background": "#21222c",
    "editorWidget.border": "#44475a",
    "input.background": "#44475a",
    "input.border": "#6272a4",
    "input.foreground": "#f8f8f2",
    "list.activeSelectionBackground": "#44475a",
    "list.hoverBackground": "#44475a75",
    "scrollbarSlider.background": "#44475a44",
    "scrollbarSlider.hoverBackground": "#44475a66",
    "scrollbarSlider.activeBackground": "#44475a88",
  },
}

// ---------------------------------------------------------------------------
// GitHub Dark
// ---------------------------------------------------------------------------
const githubDark: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "e6edf3" },
    { token: "comment", foreground: "8b949e", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7b72" },
    { token: "keyword.control", foreground: "ff7b72" },
    { token: "keyword.operator", foreground: "ff7b72" },
    { token: "string", foreground: "a5d6ff" },
    { token: "string.escape", foreground: "79c0ff" },
    { token: "number", foreground: "79c0ff" },
    { token: "constant", foreground: "79c0ff" },
    { token: "type", foreground: "ffa657" },
    { token: "type.identifier", foreground: "ffa657" },
    { token: "variable", foreground: "e6edf3" },
    { token: "variable.predefined", foreground: "ffa657" },
    { token: "function", foreground: "d2a8ff" },
    { token: "tag", foreground: "7ee787" },
    { token: "attribute.name", foreground: "79c0ff" },
    { token: "attribute.value", foreground: "a5d6ff" },
    { token: "delimiter", foreground: "e6edf3" },
    { token: "operator", foreground: "ff7b72" },
    { token: "regexp", foreground: "7ee787" },
    { token: "annotation", foreground: "d2a8ff" },
    { token: "meta", foreground: "79c0ff" },
  ],
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#e6edf3",
    "editor.lineHighlightBackground": "#161b22",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#264f7833",
    "editorCursor.foreground": "#e6edf3",
    "editorLineNumber.foreground": "#8b949e",
    "editorLineNumber.activeForeground": "#e6edf3",
    "editorGutter.background": "#0d1117",
    "editorBracketMatch.background": "#264f7844",
    "editorBracketMatch.border": "#388bfd",
    "editorIndentGuide.background": "#21262d",
    "editorIndentGuide.activeBackground": "#30363d",
    "editor.findMatchBackground": "#ffa65733",
    "editor.findMatchHighlightBackground": "#ffa65722",
    "editorWidget.background": "#161b22",
    "editorWidget.border": "#30363d",
    "input.background": "#0d1117",
    "input.border": "#30363d",
    "input.foreground": "#e6edf3",
    "list.activeSelectionBackground": "#264f78",
    "list.hoverBackground": "#161b22",
    "scrollbarSlider.background": "#8b949e22",
    "scrollbarSlider.hoverBackground": "#8b949e44",
    "scrollbarSlider.activeBackground": "#8b949e66",
  },
}

// ---------------------------------------------------------------------------
// Default Dark (neutral dark matching the app's default-dark CSS vars)
// ---------------------------------------------------------------------------
const defaultDark: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "d4d4d4" },
    { token: "comment", foreground: "6a9955", fontStyle: "italic" },
    { token: "keyword", foreground: "569cd6" },
    { token: "string", foreground: "ce9178" },
    { token: "number", foreground: "b5cea8" },
    { token: "type", foreground: "4ec9b0" },
    { token: "function", foreground: "dcdcaa" },
    { token: "variable", foreground: "9cdcfe" },
    { token: "constant", foreground: "4fc1ff" },
    { token: "tag", foreground: "569cd6" },
    { token: "attribute.name", foreground: "9cdcfe" },
    { token: "attribute.value", foreground: "ce9178" },
    { token: "operator", foreground: "d4d4d4" },
    { token: "delimiter", foreground: "d4d4d4" },
  ],
  colors: {
    "editor.background": "#1a1a1a",
    "editor.foreground": "#d4d4d4",
    "editor.lineHighlightBackground": "#2a2a2a",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#264f7833",
    "editorCursor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#d4d4d4",
    "editorGutter.background": "#1a1a1a",
    "editorWidget.background": "#252525",
    "editorWidget.border": "#3a3a3a",
    "input.background": "#3a3a3a",
    "input.border": "#4a4a4a",
    "input.foreground": "#d4d4d4",
    "scrollbarSlider.background": "#4a4a4a44",
    "scrollbarSlider.hoverBackground": "#4a4a4a66",
    "scrollbarSlider.activeBackground": "#4a4a4a88",
  },
}

// ---------------------------------------------------------------------------
// Default Light (neutral light matching the app's default-light CSS vars)
// ---------------------------------------------------------------------------
const defaultLight: MonacoThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "", foreground: "24292e" },
    { token: "comment", foreground: "6a737d", fontStyle: "italic" },
    { token: "keyword", foreground: "d73a49" },
    { token: "string", foreground: "032f62" },
    { token: "number", foreground: "005cc5" },
    { token: "type", foreground: "e36209" },
    { token: "function", foreground: "6f42c1" },
    { token: "variable", foreground: "24292e" },
    { token: "constant", foreground: "005cc5" },
    { token: "tag", foreground: "22863a" },
    { token: "attribute.name", foreground: "005cc5" },
    { token: "attribute.value", foreground: "032f62" },
    { token: "operator", foreground: "d73a49" },
    { token: "delimiter", foreground: "24292e" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#24292e",
    "editor.lineHighlightBackground": "#f6f8fa",
    "editor.selectionBackground": "#c8c8fa",
    "editor.inactiveSelectionBackground": "#c8c8fa55",
    "editorCursor.foreground": "#24292e",
    "editorLineNumber.foreground": "#8b949e",
    "editorLineNumber.activeForeground": "#24292e",
    "editorGutter.background": "#f6f8fa",
    "editorWidget.background": "#f6f8fa",
    "editorWidget.border": "#d0d7de",
    "input.background": "#ffffff",
    "input.border": "#d0d7de",
    "input.foreground": "#24292e",
    "scrollbarSlider.background": "#8b949e22",
    "scrollbarSlider.hoverBackground": "#8b949e44",
    "scrollbarSlider.activeBackground": "#8b949e66",
  },
}

// ---------------------------------------------------------------------------
// Theme registry: maps AppTheme values to Monaco theme definitions
// ---------------------------------------------------------------------------
const MONACO_THEMES: Record<string, MonacoThemeData> = {
  "catppuccin-mocha": catppuccinMocha,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-latte": catppuccinLatte,
  "dracula": draculaTheme,
  "github-dark": githubDark,
  "default-dark": defaultDark,
  "default-light": defaultLight,
}

/**
 * Register all custom themes with the Monaco instance.
 * Call this in the `beforeMount` callback of @monaco-editor/react.
 */
export function registerMonacoThemes(monaco: typeof import("monaco-editor")): void {
  for (const [name, themeData] of Object.entries(MONACO_THEMES)) {
    monaco.editor.defineTheme(name, themeData)
  }
}

/**
 * Get the Monaco theme name for a given app theme.
 * Returns a registered custom theme name, or falls back to built-in "vs"/"vs-dark".
 */
export function getMonacoThemeName(appTheme: string, resolvedMode: "dark" | "light"): string {
  if (appTheme in MONACO_THEMES) {
    return appTheme
  }

  // "system" theme — use the appropriate default based on resolved mode
  return resolvedMode === "light" ? "default-light" : "default-dark"
}
