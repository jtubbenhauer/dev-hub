import { DEFAULT_TERMINAL_SESSION_ID } from "@/lib/terminal/terminal-protocol";

export type WorkbenchTabKind =
  | "terminal"
  | "file"
  | "chat"
  | "diff"
  | "launcher";

export type DiffSource = "working" | "staged" | "compare";

export type WorkbenchTabParams =
  | { kind: "terminal"; workspaceId: string; sessionId: string; title: string }
  | { kind: "file"; workspaceId: string; path: string }
  | { kind: "chat"; workspaceId: string; sessionId: string | null }
  | {
      kind: "diff";
      workspaceId: string;
      path: string;
      source: DiffSource;
      baseRef: string | null;
    }
  | { kind: "launcher"; workspaceId: string };

export type DiffTabParams = Extract<WorkbenchTabParams, { kind: "diff" }>;

const WORKBENCH_TAB_KINDS: readonly WorkbenchTabKind[] = [
  "terminal",
  "file",
  "chat",
  "diff",
  "launcher",
];

const DIFF_SOURCES: readonly DiffSource[] = ["working", "staged", "compare"];

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench tab variant: ${String(value)}`);
}

function shortRandomHex(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function createPanelId(): string {
  return `tab-${shortRandomHex()}`;
}

// The drawer uses "default" and "term-*"; the "wb-term-" prefix keeps the two apart.
export function createWorkbenchTerminalSessionId(): string {
  return `wb-term-${shortRandomHex()}`;
}

export function tabResourceKey(
  params: WorkbenchTabParams,
  panelId: string,
): string {
  switch (params.kind) {
    case "terminal":
      return `terminal:${params.sessionId}`;
    case "file":
      return `file:${params.path}`;
    case "chat":
      return params.sessionId === null
        ? `chat:new:${panelId}`
        : `chat:${params.sessionId}`;
    case "diff":
      return `diff:${params.source}:${params.baseRef ?? ""}:${params.path}`;
    case "launcher":
      return `launcher:${panelId}`;
    default:
      return assertNever(params);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isWorkbenchTabKind(value: unknown): value is WorkbenchTabKind {
  return WORKBENCH_TAB_KINDS.some((kind) => kind === value);
}

function isDiffSource(value: unknown): value is DiffSource {
  return DIFF_SOURCES.some((source) => source === value);
}

function hasValidFieldsForKind(
  kind: WorkbenchTabKind,
  record: Record<string, unknown>,
): boolean {
  switch (kind) {
    case "terminal":
      return (
        isNonEmptyString(record.sessionId) &&
        record.sessionId !== DEFAULT_TERMINAL_SESSION_ID &&
        typeof record.title === "string"
      );
    case "file":
      return isNonEmptyString(record.path);
    case "chat":
      return record.sessionId === null || isNonEmptyString(record.sessionId);
    case "diff":
      return (
        isNonEmptyString(record.path) &&
        isDiffSource(record.source) &&
        (record.source === "compare"
          ? isNonEmptyString(record.baseRef)
          : record.baseRef === null || typeof record.baseRef === "string")
      );
    case "launcher":
      return true;
    default:
      return assertNever(kind);
  }
}

export function isWorkbenchTabParams(
  value: unknown,
): value is WorkbenchTabParams {
  if (!isRecord(value)) return false;
  if (!isWorkbenchTabKind(value.kind)) return false;
  if (!isNonEmptyString(value.workspaceId)) return false;
  return hasValidFieldsForKind(value.kind, value);
}

export function fileTabTitle(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

export function diffTabTitle(params: DiffTabParams): string {
  const basename = fileTabTitle(params.path);
  switch (params.source) {
    case "working":
      return `${basename} (working)`;
    case "staged":
      return `${basename} (staged)`;
    case "compare":
      return `${basename} ↔ ${params.baseRef ?? ""}`;
    default:
      return assertNever(params.source);
  }
}

// Same rule as the drawer's nextTabTitle in stores/terminal-store.ts.
export function nextTerminalTitle(existingTitles: readonly string[]): string {
  const highestNumber = existingTitles.reduce((highest, title) => {
    const match = /^Terminal (\d+)$/.exec(title);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `Terminal ${highestNumber + 1}`;
}
