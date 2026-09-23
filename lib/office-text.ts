// DOCX and XLSX are ZIP archives of XML parts. Models reject those MIME types,
// so their text is extracted here and sent as plain text instead.

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_MIN_SIZE = 22;
const MAX_ZIP_COMMENT_SIZE = 0xffff;
const STORED = 0;
const DEFLATED = 8;

export const MAX_EXTRACTED_CHARACTERS = 200_000;

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  const scanLimit = Math.min(
    view.byteLength,
    END_OF_CENTRAL_DIRECTORY_MIN_SIZE + MAX_ZIP_COMMENT_SIZE,
  );
  const lowestOffset = view.byteLength - scanLimit;
  for (
    let offset = view.byteLength - END_OF_CENTRAL_DIRECTORY_MIN_SIZE;
    offset >= lowestOffset && offset >= 0;
    offset--
  ) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function readCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  endOfCentralDirectoryOffset: number,
): ZipEntry[] {
  const entryCount = view.getUint16(endOfCentralDirectoryOffset + 10, true);
  let offset = view.getUint32(endOfCentralDirectoryOffset + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > view.byteLength) break;
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER_SIGNATURE) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const decompressed = source.pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}

// Local headers can declare different name/extra lengths than the central
// directory, so the data offset must be recomputed from the local header.
async function readZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === STORED) return data;
  if (entry.compressionMethod === DEFLATED) return inflateRaw(data);
  throw new Error(
    `Unsupported compression method ${entry.compressionMethod} in "${entry.name}"`,
  );
}

async function readZip(file: File): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(view);
  if (endOfCentralDirectoryOffset === -1) {
    throw new Error(`"${file.name}" is not a valid Word or Excel file`);
  }

  const entries = readCentralDirectory(
    bytes,
    view,
    endOfCentralDirectoryOffset,
  );
  const contents = new Map<string, Uint8Array>();
  for (const entry of entries) {
    contents.set(entry.name, await readZipEntry(bytes, view, entry));
  }
  return contents;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

function stripXmlTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]*>/g, ""));
}

function truncate(text: string, filename: string): string {
  if (text.length <= MAX_EXTRACTED_CHARACTERS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARACTERS)}\n\n[Extracted text from "${filename}" was truncated.]`;
}

function decodeEntry(
  contents: Map<string, Uint8Array>,
  name: string,
): string | null {
  const entry = contents.get(name);
  return entry ? new TextDecoder().decode(entry) : null;
}

export async function extractDocxText(file: File): Promise<string> {
  const contents = await readZip(file);
  const documentXml = decodeEntry(contents, "word/document.xml");
  if (documentXml === null) {
    throw new Error(`"${file.name}" does not contain readable Word content`);
  }

  const text = documentXml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");

  return truncate(
    stripXmlTags(text)
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    file.name,
  );
}

function parseSharedStrings(xml: string | null): string[] {
  if (xml === null) return [];
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [];
  return items.map((item) => stripXmlTags(item));
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.replace(/[^A-Za-z]/g, "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function escapeCsvValue(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function readCellValue(cellXml: string, sharedStrings: string[]): string {
  const type = cellXml.match(/\st="([^"]+)"/)?.[1];

  if (type === "inlineStr") {
    const inline = cellXml.match(/<is\b[^>]*>[\s\S]*?<\/is>/)?.[0];
    return inline ? stripXmlTags(inline) : "";
  }

  const rawValue = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (rawValue === undefined) return "";

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }
  return decodeXmlEntities(rawValue);
}

function parseSheetRows(sheetXml: string, sharedStrings: string[]): string[] {
  const rows = sheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];

  return rows.map((rowXml) => {
    const cells = rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
    const values: string[] = [];

    for (const cellXml of cells) {
      const cellRef = cellXml.match(/\sr="([A-Z]+\d+)"/)?.[1];
      const columnIndex = cellRef
        ? columnIndexFromCellRef(cellRef)
        : values.length;
      while (values.length < columnIndex) values.push("");
      values.push(readCellValue(cellXml, sharedStrings));
    }

    return values.map(escapeCsvValue).join(",");
  });
}

function sheetNumberFromPath(path: string): number {
  return Number(path.match(/sheet(\d+)\.xml$/)?.[1] ?? 0);
}

export async function extractXlsxText(file: File): Promise<string> {
  const contents = await readZip(file);
  const sharedStrings = parseSharedStrings(
    decodeEntry(contents, "xl/sharedStrings.xml"),
  );

  const sheetPaths = Array.from(contents.keys())
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(
      (left, right) => sheetNumberFromPath(left) - sheetNumberFromPath(right),
    );

  if (sheetPaths.length === 0) {
    throw new Error(`"${file.name}" does not contain any readable sheets`);
  }

  const workbookXml = decodeEntry(contents, "xl/workbook.xml") ?? "";
  const sheetNames = (workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? [])
    .map((sheetTag) => sheetTag.match(/\sname="([^"]*)"/)?.[1])
    .filter((name): name is string => name !== undefined)
    .map((name) => decodeXmlEntities(name));

  const sections: string[] = [];
  for (const [index, sheetPath] of sheetPaths.entries()) {
    const sheetXml = decodeEntry(contents, sheetPath);
    if (sheetXml === null) continue;

    const rows = parseSheetRows(sheetXml, sharedStrings);
    const sheetName = sheetNames[index] ?? `Sheet${index + 1}`;
    sections.push(`# ${sheetName}\n${rows.join("\n")}`.trimEnd());
  }

  return truncate(sections.join("\n\n").trim(), file.name);
}
