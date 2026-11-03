import type { SessionAgeFilter } from "@/lib/session-filters";

export type ChatListView = "unified" | "workspace";

export interface ParsedChatUrlState {
  readonly hasChatState: boolean;
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
  readonly view: ChatListView | null;
  readonly groupByWorkspace: boolean | null;
  readonly age: SessionAgeFilter | null;
}

const CHAT_URL_KEYS = [
  "workspaceId",
  "sessionId",
  "view",
  "group",
  "age",
] as const;

function getNonEmptySearchParam(
  searchParams: URLSearchParams,
  key: string,
): string | null {
  const value = searchParams.get(key);
  return value ? value : null;
}

export function parseChatUrlState(
  searchParams: URLSearchParams,
): ParsedChatUrlState {
  const viewParam = searchParams.get("view");
  const groupParam = searchParams.get("group");
  const ageParam = searchParams.get("age");

  return {
    hasChatState: CHAT_URL_KEYS.some((key) => searchParams.has(key)),
    workspaceId: getNonEmptySearchParam(searchParams, "workspaceId"),
    sessionId: getNonEmptySearchParam(searchParams, "sessionId"),
    view:
      viewParam === "unified" || viewParam === "workspace" ? viewParam : null,
    groupByWorkspace:
      groupParam === "1" ? true : groupParam === "0" ? false : null,
    age:
      ageParam === "1d" || ageParam === "1w" || ageParam === "all"
        ? ageParam
        : null,
  };
}
