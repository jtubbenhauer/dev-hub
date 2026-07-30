import type { Part } from "@/lib/opencode/types";

export interface MessagePartDelta {
  readonly sessionID: string;
  readonly messageID: string;
  readonly partID: string;
  readonly field: string;
  readonly delta: string;
}

export class PartDeltaBuffer {
  private readonly entries = new Map<
    string,
    MessagePartDelta & { readonly text: string }
  >();
  private totalChars = 0;

  constructor(
    private readonly maxPartChars = 64 * 1024,
    private readonly maxTotalChars = 1024 * 1024,
  ) {}

  add(event: MessagePartDelta): void {
    if (event.field !== "text") return;
    const key = partDeltaKey(event.sessionID, event.messageID, event.partID);
    const existing = this.entries.get(key);
    const text = ((existing?.text ?? "") + event.delta).slice(
      -this.maxPartChars,
    );
    if (existing) {
      this.totalChars -= existing.text.length;
      this.entries.delete(key);
    }
    this.entries.set(key, { ...event, text });
    this.totalChars += text.length;

    while (this.totalChars > this.maxTotalChars) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.deleteByKey(oldest.value);
    }
  }

  take(
    sessionID: string,
    messageID: string,
    partID: string,
  ): string | undefined {
    const key = partDeltaKey(sessionID, messageID, partID);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.deleteByKey(key);
    return entry.text;
  }

  remove(sessionID: string, messageID: string, partID: string): void {
    this.deleteByKey(partDeltaKey(sessionID, messageID, partID));
  }

  clearSession(sessionID: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.sessionID === sessionID) this.deleteByKey(key);
    }
  }

  clearMessage(sessionID: string, messageID: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.sessionID === sessionID && entry.messageID === messageID) {
        this.deleteByKey(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalChars = 0;
  }

  private deleteByKey(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalChars -= entry.text.length;
  }
}

export function parseMessagePartDelta(
  properties: unknown,
): MessagePartDelta | null {
  if (!isRecord(properties)) return null;
  const { sessionID, messageID, partID, field, delta } = properties;
  if (
    typeof sessionID !== "string" ||
    typeof messageID !== "string" ||
    typeof partID !== "string" ||
    typeof field !== "string" ||
    typeof delta !== "string"
  ) {
    return null;
  }
  return { sessionID, messageID, partID, field, delta };
}

export function applyMessagePartDelta(
  part: Part,
  event: MessagePartDelta,
): Part | null {
  if (
    event.field !== "text" ||
    event.sessionID !== part.sessionID ||
    event.messageID !== part.messageID ||
    event.partID !== part.id ||
    !isTextualPart(part)
  ) {
    return null;
  }
  return { ...part, text: part.text + event.delta };
}

export function reconcilePartSnapshot(
  existing: Part | undefined,
  incoming: Part,
  bufferedText: string | undefined,
): Part {
  if (!isTextualPart(incoming)) return incoming;

  let text = incoming.text;
  if (
    existing &&
    isTextualPart(existing) &&
    existing.id === incoming.id &&
    existing.text.startsWith(text)
  ) {
    text = existing.text;
  }
  if (bufferedText && !text.endsWith(bufferedText)) {
    text += bufferedText;
  }
  if (text !== incoming.text) return { ...incoming, text };
  return incoming;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextualPart(
  part: Part,
): part is Extract<Part, { type: "text" | "reasoning" }> {
  return part.type === "text" || part.type === "reasoning";
}

function partDeltaKey(
  sessionID: string,
  messageID: string,
  partID: string,
): string {
  return `${sessionID}\u0000${messageID}\u0000${partID}`;
}
