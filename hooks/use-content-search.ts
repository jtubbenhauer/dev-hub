import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildContentSearchParams,
  parseContentSearchOutcome,
  type ContentSearchOutcome,
  type ContentSearchQuery,
} from "@devhub/shared";

const CONTENT_SEARCH_DEBOUNCE_MS = 300;

interface UseContentSearchInput {
  readonly workspaceId: string | null;
  // Must be memoized by the caller; a new object restarts the debounce.
  readonly query: ContentSearchQuery;
}

interface UseContentSearchResult {
  readonly outcome: ContentSearchOutcome | null;
  readonly isSearching: boolean;
  readonly refresh: () => void;
}

export function useContentSearch({
  workspaceId,
  query,
}: UseContentSearchInput): UseContentSearchResult {
  const paramsString = useMemo(
    () => buildContentSearchParams(query).toString(),
    [query],
  );
  // Starts at the current params so a restored pattern searches at mount.
  const [debouncedParams, setDebouncedParams] = useState(paramsString);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedParams(paramsString),
      CONTENT_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [paramsString]);

  const debouncedPattern =
    new URLSearchParams(debouncedParams).get("pattern") ?? "";

  const { data, isFetching, refetch } = useQuery<ContentSearchOutcome>({
    queryKey: ["content-search", workspaceId, debouncedParams],
    queryFn: async ({ signal }) => {
      if (workspaceId === null) {
        return { kind: "failed", message: "No workspace selected" };
      }
      const response = await fetch(
        `/api/files/grep?workspaceId=${encodeURIComponent(workspaceId)}&${debouncedParams}`,
        { signal },
      );
      const body: unknown = await response.json().catch(() => null);
      return (
        parseContentSearchOutcome(body) ?? {
          kind: "failed",
          message: `Search failed (${response.status})`,
        }
      );
    },
    enabled: workspaceId !== null && debouncedPattern.length > 0,
    staleTime: 10_000,
    // Keep old results while a new pattern loads, but never across workspaces.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === workspaceId ? previousData : undefined,
  });

  const refresh = () => {
    // A disabled query must never be refetched.
    if (workspaceId === null || debouncedPattern.length === 0) return;
    void refetch();
  };

  return {
    outcome: debouncedPattern.length === 0 ? null : (data ?? null),
    isSearching: isFetching || paramsString !== debouncedParams,
    refresh,
  };
}
