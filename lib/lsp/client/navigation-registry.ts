import type { LspSurface } from "@/lib/lsp/types";

type OpenFileHandler = (
  relativePath: string,
  isCurrent: () => boolean,
) => Promise<boolean>;
type NavigationTarget = {
  readonly uriKey: string;
  readonly lineNumber: number;
  readonly column: number;
};
type PendingNavigation = NavigationTarget & {
  readonly token: number;
  opened: boolean;
};

const handlers = new Map<LspSurface, OpenFileHandler>();
const pendingBySurface = new Map<LspSurface, PendingNavigation>();
const latestTokenBySurface = new Map<
  LspSurface,
  { readonly token: number; readonly issuedAt: number }
>();
const NAVIGATION_EXPIRY_MS = 10_000;
let nextToken = 0;

export function registerLspOpenFileHandler(
  surface: LspSurface,
  handler: OpenFileHandler,
): () => void {
  handlers.set(surface, handler);
  return () => {
    if (handlers.get(surface) === handler) handlers.delete(surface);
  };
}

export function getLspOpenFileHandler(
  surface: string | null | undefined,
): OpenFileHandler | undefined {
  if (surface !== "files-page" && surface !== "split-panel") return undefined;
  return handlers.get(surface);
}

export function isPendingNavigationCurrent(
  surface: LspSurface,
  token: number,
): boolean {
  const latest = latestTokenBySurface.get(surface);
  return (
    latest !== undefined &&
    latest.token === token &&
    Date.now() - latest.issuedAt < NAVIGATION_EXPIRY_MS
  );
}

export function setPendingNavigation(
  surface: LspSurface,
  target: NavigationTarget,
): number {
  const token = ++nextToken;
  pendingBySurface.set(surface, { token, ...target, opened: false });
  latestTokenBySurface.set(surface, { token, issuedAt: Date.now() });
  return token;
}

export function clearPendingNavigation(
  surface: LspSurface,
  token: number,
): void {
  if (pendingBySurface.get(surface)?.token === token)
    pendingBySurface.delete(surface);
}

export function markPendingNavigationOpened(
  surface: LspSurface,
  token: number,
): void {
  const pending = pendingBySurface.get(surface);
  if (pending?.token === token) pending.opened = true;
}

export function takePendingNavigation(
  surface: string | null | undefined,
  uriKey: string,
): { lineNumber: number; column: number } | null {
  if (surface !== "files-page" && surface !== "split-panel") return null;
  const pending = pendingBySurface.get(surface);
  if (!pending) return null;
  if (!isPendingNavigationCurrent(surface, pending.token)) {
    pendingBySurface.delete(surface);
    return null;
  }
  if (pending.uriKey === uriKey) {
    pendingBySurface.delete(surface);
    return { lineNumber: pending.lineNumber, column: pending.column };
  }
  if (pending.opened) pendingBySurface.delete(surface);
  return null;
}
