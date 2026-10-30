const STORAGE_KEY_PREFIX = "devhub:pending-terminal-output";
export const TERMINAL_OUTPUT_TO_CHAT_EVENT = "attach-terminal-output-to-chat";
export const MAX_TERMINAL_OUTPUT_CHARS = 20_000;

function storageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceId}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

export function formatTerminalOutputForChat(
  output: string,
  sourceLabel: string,
): string {
  const trimmed = output.replace(/\s+$/, "");
  const clipped =
    trimmed.length > MAX_TERMINAL_OUTPUT_CHARS
      ? `[... earlier output truncated ...]\n${trimmed.slice(-MAX_TERMINAL_OUTPUT_CHARS)}`
      : trimmed;
  const fence = "`".repeat(Math.max(3, longestBacktickRun(clipped) + 1));
  return `Terminal output (${sourceLabel}):\n${fence}text\n${clipped}\n${fence}`;
}

export function appendToComposerText(
  current: string,
  addition: string,
): string {
  if (!current.trim()) return addition;
  return `${current.replace(/\s+$/, "")}\n\n${addition}`;
}

export function queueTerminalOutputForChat(
  workspaceId: string,
  formattedOutput: string,
): void {
  const pending = localStorage.getItem(storageKey(workspaceId));
  localStorage.setItem(
    storageKey(workspaceId),
    pending ? appendToComposerText(pending, formattedOutput) : formattedOutput,
  );
  window.dispatchEvent(new CustomEvent(TERMINAL_OUTPUT_TO_CHAT_EVENT));
}

export function takePendingTerminalOutput(workspaceId: string): string | null {
  const pending = localStorage.getItem(storageKey(workspaceId));
  if (pending === null) return null;
  localStorage.removeItem(storageKey(workspaceId));
  return pending;
}
