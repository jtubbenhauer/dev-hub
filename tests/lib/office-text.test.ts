import { describe, it, expect } from "vitest";
import {
  extractDocxText,
  extractXlsxText,
  MAX_EXTRACTED_CHARACTERS,
} from "@/lib/office-text";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function createZipFile(
  filename: string,
  entries: Record<string, string>,
  { compress = true }: { compress?: boolean } = {},
): Promise<File> {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const uncompressed = encoder.encode(content);
    const stored = compress ? await deflateRaw(uncompressed) : uncompressed;
    const method = compress ? 8 : 0;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, uncompressed.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, CENTRAL_FILE_HEADER_SIGNATURE, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, uncompressed.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, stored);
    centralChunks.push(centralHeader);
    offset += localHeader.length + stored.length;
  }

  const centralSize = centralChunks.reduce(
    (total, chunk) => total + chunk.length,
    0,
  );
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(8, centralChunks.length, true);
  endView.setUint16(10, centralChunks.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const parts: BlobPart[] = [...localChunks, ...centralChunks, endRecord].map(
    (chunk) => chunk as BlobPart,
  );
  return new File(parts, filename);
}

function docxWithParagraphs(paragraphs: string[]): string {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join("");
  return `<?xml version="1.0"?><w:document xmlns:w="http://x"><w:body>${body}</w:body></w:document>`;
}

describe("extractDocxText", () => {
  it("extracts paragraph text from a deflated docx", async () => {
    const file = await createZipFile("memo.docx", {
      "word/document.xml": docxWithParagraphs([
        "Quarterly revenue rose 12%.",
        "Codeword: PLATYPUS",
      ]),
    });

    const text = await extractDocxText(file);

    expect(text).toBe("Quarterly revenue rose 12%.\nCodeword: PLATYPUS");
  });

  it("extracts text from an uncompressed (stored) docx", async () => {
    const file = await createZipFile(
      "memo.docx",
      { "word/document.xml": docxWithParagraphs(["Stored entry"]) },
      { compress: false },
    );

    await expect(extractDocxText(file)).resolves.toBe("Stored entry");
  });

  it("decodes XML entities rather than leaking escapes", async () => {
    const file = await createZipFile("memo.docx", {
      "word/document.xml": docxWithParagraphs([
        "Tom &amp; Jerry &lt;tag&gt; &quot;quoted&quot;",
      ]),
    });

    await expect(extractDocxText(file)).resolves.toBe(
      'Tom & Jerry <tag> "quoted"',
    );
  });

  it("converts tabs and line breaks to whitespace", async () => {
    const file = await createZipFile("memo.docx", {
      "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://x"><w:body><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p></w:body></w:document>`,
    });

    await expect(extractDocxText(file)).resolves.toBe("A\tB\nC");
  });

  it("joins multiple runs inside one paragraph without inserting spaces", async () => {
    const file = await createZipFile("memo.docx", {
      "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://x"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p></w:body></w:document>`,
    });

    await expect(extractDocxText(file)).resolves.toBe("Hello world");
  });

  it("rejects a file that is not a zip archive", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "broken.docx");

    await expect(extractDocxText(file)).rejects.toThrow(
      '"broken.docx" is not a valid Word or Excel file',
    );
  });

  it("rejects a zip archive without Word content", async () => {
    const file = await createZipFile("memo.docx", { "other.xml": "<a/>" });

    await expect(extractDocxText(file)).rejects.toThrow(
      "does not contain readable Word content",
    );
  });

  it("truncates very large documents", async () => {
    const longParagraph = "x".repeat(MAX_EXTRACTED_CHARACTERS + 5_000);
    const file = await createZipFile("big.docx", {
      "word/document.xml": docxWithParagraphs([longParagraph]),
    });

    const text = await extractDocxText(file);

    expect(text).toContain("was truncated");
    expect(text.length).toBeLessThan(MAX_EXTRACTED_CHARACTERS + 200);
  });
});

function sheetXml(rows: string[][]): string {
  const rowXml = rows
    .map((cells, rowIndex) => {
      const cellXml = cells
        .map((value, columnIndex) => {
          const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}"><v>${value}</v></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0"?><worksheet><sheetData>${rowXml}</sheetData></worksheet>`;
}

describe("extractXlsxText", () => {
  it("renders numeric cells as CSV rows under the sheet name", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Revenue" sheetId="1"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": sheetXml([
        ["1", "2"],
        ["3", "4"],
      ]),
    });

    await expect(extractXlsxText(file)).resolves.toBe("# Revenue\n1,2\n3,4");
  });

  it("resolves shared string cells to their text", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Cities" sheetId="1"/></sheets></workbook>`,
      "xl/sharedStrings.xml": `<sst><si><t>city</t></si><si><t>London</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`,
    });

    await expect(extractXlsxText(file)).resolves.toBe("# Cities\ncity\nLondon");
  });

  it("pads gaps so values stay in their original columns", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Sparse" sheetId="1"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row></sheetData></worksheet>`,
    });

    await expect(extractXlsxText(file)).resolves.toBe("# Sparse\n1,,3");
  });

  it("quotes values containing commas", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>`,
      "xl/sharedStrings.xml": `<sst><si><t>London, UK</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
    });

    await expect(extractXlsxText(file)).resolves.toBe('# Sheet1\n"London, UK"');
  });

  it("reads inline string cells", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>inline value</t></is></c></row></sheetData></worksheet>`,
    });

    await expect(extractXlsxText(file)).resolves.toBe("# Sheet1\ninline value");
  });

  it("extracts every sheet in workbook order", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets><sheet name="First" sheetId="1"/><sheet name="Second" sheetId="2"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": sheetXml([["1"]]),
      "xl/worksheets/sheet2.xml": sheetXml([["2"]]),
    });

    await expect(extractXlsxText(file)).resolves.toBe(
      "# First\n1\n\n# Second\n2",
    );
  });

  it("rejects a workbook with no sheets", async () => {
    const file = await createZipFile("data.xlsx", {
      "xl/workbook.xml": `<workbook><sheets/></workbook>`,
    });

    await expect(extractXlsxText(file)).rejects.toThrow(
      "does not contain any readable sheets",
    );
  });
});
