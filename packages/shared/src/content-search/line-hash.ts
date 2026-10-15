import { createHash } from "node:crypto";

// Node-only: never export from the @devhub/shared barrel.
export function sha256Utf8Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
