import type { LspPosition, LspRange, LspTextEdit } from "@/lib/lsp/types";

function offsetAt(text: string, position: LspPosition): number {
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const end = text.indexOf("\n", offset);
    if (end === -1) return text.length;
    offset = end + 1;
  }
  const end = text.indexOf("\n", offset);
  return Math.min(
    offset + Math.max(0, position.character),
    end === -1 ? text.length : end,
  );
}

export function applyLspTextEdits(
  text: string,
  edits: readonly LspTextEdit[],
): string {
  const offsets = edits
    .map((edit, index) => ({
      start: offsetAt(text, edit.range.start),
      end: offsetAt(text, edit.range.end),
      newText: edit.newText,
      index,
    }))
    .sort(
      (left, right) => left.start - right.start || left.index - right.index,
    );
  let previousEnd = 0;
  for (const edit of offsets) {
    if (edit.start < previousEnd || edit.end < edit.start)
      throw new Error("overlapping text edits");
    previousEnd = edit.end;
  }
  let result = text;
  for (const edit of offsets.reverse())
    result =
      result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  return result;
}

export function applyLspContentChanges(
  text: string,
  changes: readonly { readonly text: string; readonly range?: LspRange }[],
): string {
  let result = text;
  for (const change of changes)
    result =
      change.range === undefined
        ? change.text
        : applyLspTextEdits(result, [
            { range: change.range, newText: change.text },
          ]);
  return result;
}
