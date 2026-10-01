import { describe, expect, it } from "vitest";
import { getCsvColumnWidths, parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("splits rows and cells and numbers each row by its file line", () => {
    expect(parseCsv("name,age\nAda,36\nAlan,41")).toEqual([
      { cells: ["name", "age"], startLine: 1, endLine: 1 },
      { cells: ["Ada", "36"], startLine: 2, endLine: 2 },
      { cells: ["Alan", "41"], startLine: 3, endLine: 3 },
    ]);
  });

  it("keeps commas inside quoted cells", () => {
    expect(parseCsv('city,note\nSydney,"big, sunny"')[1].cells).toEqual([
      "Sydney",
      "big, sunny",
    ]);
  });

  it("unescapes doubled quotes inside quoted cells", () => {
    expect(parseCsv('quote\n"she said ""hi"""')[1].cells).toEqual([
      'she said "hi"',
    ]);
  });

  it("spans multiple lines for a quoted cell with line breaks and keeps later rows on their real line", () => {
    expect(parseCsv('id,note\n1,"line one\nline two"\n2,after')).toEqual([
      { cells: ["id", "note"], startLine: 1, endLine: 1 },
      { cells: ["1", "line one\nline two"], startLine: 2, endLine: 3 },
      { cells: ["2", "after"], startLine: 4, endLine: 4 },
    ]);
  });

  it("treats CRLF as a single line break, inside and outside quotes", () => {
    expect(parseCsv('a,b\r\n1,"x\r\ny"\r\n2,z\r\n')).toEqual([
      { cells: ["a", "b"], startLine: 1, endLine: 1 },
      { cells: ["1", "x\r\ny"], startLine: 2, endLine: 3 },
      { cells: ["2", "z"], startLine: 4, endLine: 4 },
    ]);
  });

  it("treats a lone CR as a line break like Monaco does", () => {
    expect(parseCsv("a\rb\rc").map((row) => row.startLine)).toEqual([1, 2, 3]);
  });

  it("skips blank lines without shifting the line numbers of later rows", () => {
    expect(parseCsv("a\n\n\nb\n")).toEqual([
      { cells: ["a"], startLine: 1, endLine: 1 },
      { cells: ["b"], startLine: 4, endLine: 4 },
    ]);
  });

  it("returns no rows for empty content", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("strips a leading byte order mark from the first cell", () => {
    expect(parseCsv("\uFEFFname,age")[0].cells).toEqual(["name", "age"]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(parseCsv("a,,c,")[0].cells).toEqual(["a", "", "c", ""]);
  });

  it("keeps each row's own cell count when rows are ragged", () => {
    expect(parseCsv("a,b,c\n1\n1,2,3,4").map((row) => row.cells)).toEqual([
      ["a", "b", "c"],
      ["1"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("keeps a quote in the middle of an unquoted cell as text", () => {
    expect(parseCsv('5" pipe,ok')[0].cells).toEqual(['5" pipe', "ok"]);
  });

  it("runs an unclosed quote to the end of the file", () => {
    expect(parseCsv('a,"open\nstill open')).toEqual([
      { cells: ["a", "open\nstill open"], startLine: 1, endLine: 2 },
    ]);
  });
});

describe("getCsvColumnWidths", () => {
  it("uses the longest cell in each column across all rows", () => {
    expect(
      getCsvColumnWidths(parseCsv("id,name\n1,Ada\n22,Grace Hopper")),
    ).toEqual([3, 12]);
  });

  it("covers every column of the widest ragged row", () => {
    expect(getCsvColumnWidths(parseCsv("a\nbbbb,cccccc"))).toHaveLength(2);
  });

  it("measures a multi-line cell by its longest line", () => {
    expect(getCsvColumnWidths(parseCsv('"short\na much longer line"'))).toEqual(
      [18],
    );
  });

  it("caps long text so it wraps instead of stretching the column", () => {
    expect(getCsvColumnWidths(parseCsv("x".repeat(500)))).toEqual([40]);
  });
});
