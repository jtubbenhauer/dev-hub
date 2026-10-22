import { stripInjectedContext } from "@/lib/chat-suggest/context";

export const SESSION_TITLE_MAX_CHARS = 80;

export function titleFromUserText(text: string): string | null {
  const singleLine = stripInjectedContext(text).replace(/\s+/g, " ").trim();
  if (!singleLine) return null;
  return singleLine.slice(0, SESSION_TITLE_MAX_CHARS).trimEnd();
}
