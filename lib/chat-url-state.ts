export interface ParsedChatUrlState {
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
}

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
  return {
    workspaceId: getNonEmptySearchParam(searchParams, "workspaceId"),
    sessionId: getNonEmptySearchParam(searchParams, "sessionId"),
  };
}
