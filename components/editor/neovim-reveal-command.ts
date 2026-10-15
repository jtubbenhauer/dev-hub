import type { EditorRevealRequest } from "@/stores/editor-store";

export function hasControlCharacter(path: string): boolean {
  return Array.from(path).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}

export function buildNeovimRevealCommand(
  request: Pick<
    EditorRevealRequest,
    "path" | "lineNumber" | "startByteColumn" | "lineSha256"
  >,
): string | null {
  if (
    hasControlCharacter(request.path) ||
    !/^[0-9a-f]{64}$/.test(request.lineSha256) ||
    !Number.isInteger(request.lineNumber) ||
    request.lineNumber < 1 ||
    !Number.isInteger(request.startByteColumn) ||
    request.startByteColumn < 1
  )
    return null;

  const quote = (text: string) => text.replace(/'/g, "''");
  const p = quote(request.path);
  // Wrapped typed commands need redraw; overflow inside :if hides warnings or requires Enter.
  const warn = (message: string, reason: string) =>
    `redraw | echohl WarningMsg | echomsg (strdisplaywidth('${quote(message)}') <= v:echospace ? '${quote(message)}' : printf('%.*S', v:echospace, 'dev-hub: ${quote(reason)} (' . fnamemodify('${p}', ':t') . ')')) | echohl None`;
  return [
    `if expand('%:p') ==# fnamemodify('${p}', ':p') && &modified`,
    warn(
      `dev-hub: ${request.path} has unsaved changes, so the search match was not selected`,
      "has unsaved changes",
    ),
    `else`,
    `execute 'edit' fnameescape('${p}')`,
    `if expand('%:p') !=# fnamemodify('${p}', ':p')`,
    warn(
      `dev-hub: could not open ${request.path} for the search result`,
      "could not open",
    ),
    `elseif &modified`,
    warn(
      `dev-hub: ${request.path} has unsaved changes, so the search match was not selected`,
      "has unsaved changes",
    ),
    `else`,
    `edit`,
    `if ${request.lineNumber} > line('$') || sha256(getline(${request.lineNumber})) !=# '${request.lineSha256}'`,
    warn(
      `dev-hub: ${request.path} changed since the search ran. Search again.`,
      "changed since the search ran. Search again.",
    ),
    `else`,
    `call cursor(${request.lineNumber}, ${request.startByteColumn})`,
    `execute 'normal! zz'`,
    `endif`,
    `endif`,
    `endif`,
  ].join(" | ");
}
