import { StringDecoder } from "node:string_decoder";

export const MAX_JSONL_RECORD_CHARACTERS = 16_777_216;

export type JsonlLineDecoder = {
  readonly write: (chunk: string | Uint8Array) => void;
  readonly end: () => void;
};

export function createJsonlLineDecoder(
  onLine: (line: string) => void,
  onOversizedLine: () => void,
): JsonlLineDecoder {
  const textDecoder = new StringDecoder("utf8");
  let buffer = "";
  let isDiscardingOversizedLine = false;

  const consume = (text: string): void => {
    let offset = 0;
    while (offset < text.length) {
      if (isDiscardingOversizedLine) {
        const newlineIndex = text.indexOf("\n", offset);
        if (newlineIndex === -1) return;
        isDiscardingOversizedLine = false;
        offset = newlineIndex + 1;
        continue;
      }

      const newlineIndex = text.indexOf("\n", offset);
      if (newlineIndex === -1) {
        const remainder = text.slice(offset);
        if (buffer.length + remainder.length > MAX_JSONL_RECORD_CHARACTERS) {
          buffer = "";
          isDiscardingOversizedLine = true;
          onOversizedLine();
        } else {
          buffer += remainder;
        }
        return;
      }

      const segment = text.slice(offset, newlineIndex);
      if (buffer.length + segment.length > MAX_JSONL_RECORD_CHARACTERS) {
        onOversizedLine();
      } else {
        const line = buffer + segment;
        onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
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
      if (!isDiscardingOversizedLine && buffer.length > 0) onLine(buffer);
      buffer = "";
      isDiscardingOversizedLine = false;
    },
  };
}

export function encodeJsonlLine(message: string): string {
  return `${message}\n`;
}
