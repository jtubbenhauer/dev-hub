import type * as Monaco from "monaco-editor";
import type { connectLspSession } from "@/lib/lsp/client/lsp-session";

// Kept free of value imports that reach the Monaco stack: the global LSP driver
// imports this module from the root layout on every page.

export type LspSessionConnector = typeof connectLspSession;

export interface ActiveLspSession {
  readonly workspaceRoot: string;
}

let registeredMonaco: typeof Monaco | null = null;
let activeSession: ActiveLspSession | null = null;
let sessionConnector: LspSessionConnector | null = null;

export function setRegisteredLspMonaco(monaco: typeof Monaco): void {
  registeredMonaco = monaco;
}

export function getRegisteredLspMonaco(): typeof Monaco | null {
  return registeredMonaco;
}

export function setActiveLspSession(session: ActiveLspSession | null): void {
  activeSession = session;
}

export function getActiveLspSession(): ActiveLspSession | null {
  return activeSession;
}

export function getActiveLspWorkspaceRoot(): string | null {
  return activeSession?.workspaceRoot ?? null;
}

export function registerLspSessionConnector(
  connect: LspSessionConnector,
): void {
  sessionConnector = connect;
}

export function getLspSessionConnector(): LspSessionConnector | null {
  return sessionConnector;
}
