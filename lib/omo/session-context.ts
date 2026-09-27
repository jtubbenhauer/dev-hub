const MAX_CONTEXT_KEYS = 32;
const MAX_CONTEXT_VALUE_BYTES = 16 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 32 * 1024;
const CONTEXT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export type OmoSessionContext = Readonly<Record<string, string>>;

export function parseOmoSessionContext(
  value: unknown,
): OmoSessionContext | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_CONTEXT_KEYS) return null;

  let totalBytes = 0;
  const context: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (!CONTEXT_KEY_PATTERN.test(key) || typeof entryValue !== "string") {
      return null;
    }
    const valueBytes = Buffer.byteLength(entryValue);
    if (valueBytes > MAX_CONTEXT_VALUE_BYTES) return null;
    totalBytes += valueBytes;
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) return null;
    context[key] = entryValue;
  }
  return context;
}

export function readStoredContext(row: {
  readonly context: string | null;
}): OmoSessionContext | null {
  if (row.context === null) return null;
  try {
    return parseOmoSessionContext(JSON.parse(row.context));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
