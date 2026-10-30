import type { ITheme } from "@xterm/xterm";

function resolveColor(varName: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return "";
  const el = document.createElement("div");
  el.style.color = raw;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  el.remove();
  return resolved;
}

export function buildTerminalTheme(): ITheme {
  const bg = resolveColor("--background");
  const fg = resolveColor("--foreground");
  const accent = resolveColor("--accent");
  const isDark = document.documentElement.classList.contains("dark");

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: accent,
    selectionForeground: fg,
    black: isDark ? "#45475a" : "#bcc0cc",
    red: isDark ? "#f38ba8" : "#d20f39",
    green: isDark ? "#a6e3a1" : "#40a02b",
    yellow: isDark ? "#f9e2af" : "#df8e1d",
    blue: isDark ? "#89b4fa" : "#1e66f5",
    magenta: isDark ? "#cba6f7" : "#8839ef",
    cyan: isDark ? "#94e2d5" : "#179299",
    white: isDark ? "#bac2de" : "#4c4f69",
    brightBlack: isDark ? "#585b70" : "#acb0be",
    brightRed: isDark ? "#f38ba8" : "#d20f39",
    brightGreen: isDark ? "#a6e3a1" : "#40a02b",
    brightYellow: isDark ? "#f9e2af" : "#df8e1d",
    brightBlue: isDark ? "#89b4fa" : "#1e66f5",
    brightMagenta: isDark ? "#cba6f7" : "#8839ef",
    brightCyan: isDark ? "#94e2d5" : "#179299",
    brightWhite: isDark ? "#a6adc8" : "#5c5f77",
  };
}

// next/font exposes families as CSS variables on <body>. FontFaceSet.load()
// rejects var() outright, so resolve them to the concrete family names.
export function resolveTerminalFontFamily(fontFamily: string): string {
  const bodyStyles = getComputedStyle(document.body);
  return fontFamily.replace(
    /var\((--[\w-]+)\)/g,
    (match, variableName: string) =>
      bodyStyles.getPropertyValue(variableName).trim() || match,
  );
}

// The theme provider swaps classes on <html> (dark/light plus a flavour class).
export function observeThemeChanges(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
