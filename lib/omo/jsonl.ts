import { StringDecoder } from "node:string_decoder";

export const MAX_JSONL_RECORD_CHARACTERS = 16_777_216;

export type JsonlRecord = Readonly<Record<string, unknown>>;

export type JsonlDecoder = {
  readonly write: (chunk: string | Uint8Array) => void;
  readonly end: () => void;
};

const PARSE_FAILURE = {
  type: "response",
  command: "parse",
  success: false,
} as const satisfies JsonlRecord;

function isJsonlRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createJsonlDecoder(
  onRecord: (record: JsonlRecord) => void,
): JsonlDecoder {
  const textDecoder = new StringDecoder("utf8");
  let buffer = "";
  let isDiscardingOversizedRecord = false;

  const emitLine = (line: string): void => {
    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    try {
      const parsed: unknown = JSON.parse(normalizedLine);
      onRecord(isJsonlRecord(parsed) ? parsed : PARSE_FAILURE);
    } catch (error) {
      if (error instanceof SyntaxError) {
        onRecord(PARSE_FAILURE);
        return;
      }
      throw error;
    }
  };

  const consume = (text: string): void => {
    let offset = 0;
    while (offset < text.length) {
      if (isDiscardingOversizedRecord) {
        const newlineIndex = text.indexOf("\n", offset);
        if (newlineIndex === -1) return;
        isDiscardingOversizedRecord = false;
        offset = newlineIndex + 1;
        continue;
      }

      const newlineIndex = text.indexOf("\n", offset);
      if (newlineIndex === -1) {
        const remainder = text.slice(offset);
        if (buffer.length + remainder.length > MAX_JSONL_RECORD_CHARACTERS) {
          buffer = "";
          isDiscardingOversizedRecord = true;
          onRecord(PARSE_FAILURE);
        } else {
          buffer += remainder;
        }
        return;
      }

      const segment = text.slice(offset, newlineIndex);
      if (buffer.length + segment.length > MAX_JSONL_RECORD_CHARACTERS) {
        onRecord(PARSE_FAILURE);
      } else {
        emitLine(buffer + segment);
      }
      buffer = "";
      offset = newlineIndex + 1;
    }
  };

  return {
    write(chunk): void {
      consume(
        typeof chunk === "string"
          ? chunk
          : textDecoder.write(Buffer.from(chunk)),
      );
    },
    end(): void {
      consume(textDecoder.end());
      if (!isDiscardingOversizedRecord && buffer.length > 0) emitLine(buffer);
      buffer = "";
      isDiscardingOversizedRecord = false;
    },
  };
}

export function encodeJsonl(record: JsonlRecord): string {
  return `${JSON.stringify(record)}\n`;
}
