import { parseChatUrlState } from "@/lib/chat-url-state";

export const WORKBENCH_PATH = "/workbench";

export type WorkbenchIntent =
  | {
      readonly open: "chat";
      readonly workspaceId: string | null;
      readonly sessionId: string | null;
    }
  | {
      readonly open: "file";
      readonly workspaceId: string | null;
      readonly path: string;
    }
  | {
      readonly open: "folder";
      readonly workspaceId: string | null;
      readonly path: string;
    }
  | { readonly open: "explorer"; readonly workspaceId: string | null }
  | { readonly open: "search"; readonly workspaceId: string | null }
  | { readonly open: "terminal"; readonly workspaceId: string | null }
  | { readonly open: "new-chat"; readonly workspaceId: string | null };

export type WorkbenchIntentKind = WorkbenchIntent["open"];

interface WorkbenchIntentTarget {
  readonly sessionId: string | null;
  readonly path: string | null;
}

const WORKSPACE_ONLY_TARGET: WorkbenchIntentTarget = {
  sessionId: null,
  path: null,
};

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench intent: ${JSON.stringify(value)}`);
}

function readNonEmptySearchParam(
  params: URLSearchParams,
  key: string,
): string | null {
  const value = params.get(key);
  return value ? value : null;
}

function readIntentTarget(intent: WorkbenchIntent): WorkbenchIntentTarget {
  switch (intent.open) {
    case "chat":
      return { sessionId: intent.sessionId, path: null };
    case "file":
    case "folder":
      return { sessionId: null, path: intent.path };
    case "explorer":
    case "search":
    case "terminal":
    case "new-chat":
      return WORKSPACE_ONLY_TARGET;
    default:
      return assertNever(intent);
  }
}

export function createWorkbenchHref(intent: WorkbenchIntent | null): string {
  if (intent === null) return WORKBENCH_PATH;

  const { sessionId, path } = readIntentTarget(intent);
  const searchParams = new URLSearchParams();
  if (intent.workspaceId) searchParams.set("workspaceId", intent.workspaceId);
  searchParams.set("open", intent.open);
  if (sessionId) searchParams.set("sessionId", sessionId);
  if (path) searchParams.set("path", path);

  return `${WORKBENCH_PATH}?${searchParams.toString()}`;
}

export function parseWorkbenchIntent(
  params: URLSearchParams,
): WorkbenchIntent | null {
  const workspaceId = readNonEmptySearchParam(params, "workspaceId");
  const open = params.get("open");

  switch (open) {
    case "chat":
      return {
        open,
        workspaceId,
        sessionId: readNonEmptySearchParam(params, "sessionId"),
      };
    case "file":
    case "folder": {
      const path = readNonEmptySearchParam(params, "path");
      return path ? { open, workspaceId, path } : null;
    }
    case "explorer":
    case "search":
    case "terminal":
    case "new-chat":
      return { open, workspaceId };
    default:
      return null;
  }
}

export function legacyChatSearchToHref(params: URLSearchParams): string {
  const { workspaceId, sessionId } = parseChatUrlState(params);
  return createWorkbenchHref({ open: "chat", workspaceId, sessionId });
}

export function legacyFilesSearchToHref(params: URLSearchParams): string {
  const openPath = readNonEmptySearchParam(params, "open");
  if (openPath) {
    return createWorkbenchHref({
      open: "file",
      workspaceId: null,
      path: openPath,
    });
  }

  const expandPath = readNonEmptySearchParam(params, "expand");
  if (expandPath) {
    return createWorkbenchHref({
      open: "folder",
      workspaceId: null,
      path: expandPath,
    });
  }

  return createWorkbenchHref({ open: "explorer", workspaceId: null });
}

export function legacyTerminalSearchToHref(params: URLSearchParams): string {
  return createWorkbenchHref({
    open: "terminal",
    workspaceId: readNonEmptySearchParam(params, "workspace"),
  });
}
