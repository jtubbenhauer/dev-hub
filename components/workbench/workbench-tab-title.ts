import {
  diffTabTitle,
  fileTabTitle,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";
import { LAUNCHER_TAB_TITLE } from "@/lib/workbench/workbench-commands";

export const NEW_CHAT_TAB_TITLE = "New chat";

export interface WorkbenchTabTitleLookups {
  readonly getChatSessionTitle: (
    workspaceId: string,
    sessionId: string,
  ) => string | undefined;
}

// The slice of chat-store `workspaceStates` that titles need; keeps this module store-free.
export type ChatSessionTitleSource = Readonly<
  Record<
    string,
    | {
        readonly sessions: Readonly<
          Record<string, { readonly title: string } | undefined>
        >;
      }
    | undefined
  >
>;

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench tab kind: ${String(value)}`);
}

export function createChatSessionTitleLookups(
  workspaceStates: ChatSessionTitleSource,
): WorkbenchTabTitleLookups {
  return {
    getChatSessionTitle: (workspaceId, sessionId) =>
      workspaceStates[workspaceId]?.sessions[sessionId]?.title,
  };
}

export function workbenchTabTitle(
  params: WorkbenchTabParams,
  lookups: WorkbenchTabTitleLookups,
): string {
  switch (params.kind) {
    case "chat": {
      if (params.sessionId === null) return NEW_CHAT_TAB_TITLE;
      const sessionTitle = lookups.getChatSessionTitle(
        params.workspaceId,
        params.sessionId,
      );
      return sessionTitle || NEW_CHAT_TAB_TITLE;
    }
    case "file":
      return fileTabTitle(params.path);
    case "terminal":
      return params.title;
    case "diff":
      return diffTabTitle(params);
    case "launcher":
      return LAUNCHER_TAB_TITLE;
    default:
      return assertNever(params);
  }
}
