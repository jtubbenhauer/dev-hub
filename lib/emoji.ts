import { gemoji } from "gemoji";

const SHORTCODE_MAP = new Map<string, string>();
for (const entry of gemoji) {
  for (const name of entry.names) {
    SHORTCODE_MAP.set(name, entry.emoji);
  }
}

const SHORTCODE_RE = /:([a-z0-9_+-]+):/g;

export function replaceEmoji(text: string): string {
  return text.replace(SHORTCODE_RE, (match, code: string) => {
    return SHORTCODE_MAP.get(code) ?? match;
  });
}
