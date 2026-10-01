export interface CsvRow {
  readonly cells: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
}

const BYTE_ORDER_MARK = "\uFEFF";
const QUOTE = '"';
const DELIMITER = ",";
const LINE_BREAK_PATTERN = /\r\n|\r|\n/;
const MIN_COLUMN_WIDTH_CHARS = 3;
const MAX_COLUMN_WIDTH_CHARS = 40;

// Returns 2 for "\r\n", 1 for a lone "\n" or "\r", 0 for anything else.
// Monaco treats all three as line breaks, so line numbers stay in sync with it.
function getLineBreakLength(text: string, index: number): number {
  const char = text[index];
  if (char === "\r") return text[index + 1] === "\n" ? 2 : 1;
  if (char === "\n") return 1;
  return 0;
}

// Parses RFC 4180 CSV and records the 1-based file lines each row spans, so a
// table row can be anchored to the same line numbers the text editor shows.
// Lenient like spreadsheet apps: a quote inside an unquoted cell is kept as
// text, an unclosed quote runs to the end of the file, blank lines are skipped.
export function parseCsv(content: string): CsvRow[] {
  const text = content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let isInsideQuotes = false;
  let isAtCellStart = true;
  let line = 1;
  let rowStartLine = 1;

  function finishRow() {
    cells.push(cell);
    const isBlankLine = cells.length === 1 && cell === "";
    if (!isBlankLine) {
      rows.push({ cells, startLine: rowStartLine, endLine: line });
    }
    cells = [];
    cell = "";
    isAtCellStart = true;
  }

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const lineBreakLength = getLineBreakLength(text, index);

    if (isInsideQuotes) {
      if (char === QUOTE && text[index + 1] === QUOTE) {
        cell += QUOTE;
        index += 2;
      } else if (char === QUOTE) {
        isInsideQuotes = false;
        index += 1;
      } else if (lineBreakLength > 0) {
        cell += text.slice(index, index + lineBreakLength);
        line += 1;
        index += lineBreakLength;
      } else {
        cell += char;
        index += 1;
      }
      continue;
    }

    if (lineBreakLength > 0) {
      finishRow();
      line += 1;
      rowStartLine = line;
      index += lineBreakLength;
    } else if (char === DELIMITER) {
      cells.push(cell);
      cell = "";
      isAtCellStart = true;
      index += 1;
    } else if (char === QUOTE && isAtCellStart) {
      isInsideQuotes = true;
      isAtCellStart = false;
      index += 1;
    } else {
      cell += char;
      isAtCellStart = false;
      index += 1;
    }
  }

  finishRow();
  return rows;
}

function getLongestLineLength(cell: string): number {
  if (!cell.includes("\n") && !cell.includes("\r")) return cell.length;
  return cell
    .split(LINE_BREAK_PATTERN)
    .reduce((longest, line) => Math.max(longest, line.length), 0);
}

// Clamped longest-line width per column, in characters. Measured over every
// row, not just rendered ones, so virtualized columns don't jump on scroll.
export function getCsvColumnWidths(rows: readonly CsvRow[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, columnIndex) => {
      const cellWidth = Math.min(
        Math.max(getLongestLineLength(cell), MIN_COLUMN_WIDTH_CHARS),
        MAX_COLUMN_WIDTH_CHARS,
      );
      widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, cellWidth);
    });
  }
  return widths;
}
