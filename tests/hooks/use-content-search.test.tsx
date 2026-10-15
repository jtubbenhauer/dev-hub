import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSearchOutcome, ContentSearchQuery } from "@devhub/shared";
import { useContentSearch } from "@/hooks/use-content-search";

interface HookProps {
  readonly workspaceId: string | null;
  readonly query: ContentSearchQuery;
}

const queryClients: QueryClient[] = [];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClients.push(queryClient);
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return QueryWrapper;
}

function makeQuery(overrides: Partial<ContentSearchQuery>): ContentSearchQuery {
  return {
    pattern: "",
    isRegex: false,
    isCaseSensitive: false,
    isWholeWord: false,
    includeGlobs: [],
    excludeGlobs: [],
    maxResults: 2000,
    ...overrides,
  };
}

function makeOkOutcome(path: string): ContentSearchOutcome {
  return {
    kind: "ok",
    files: [
      {
        path,
        matches: [
          {
            lineNumber: 1,
            startColumn: 1,
            endColumn: 4,
            startByteColumn: 1,
            matchFingerprint: "fingerprint",
            lineSha256: "0".repeat(64),
            preview: "abc",
            previewMatchStart: 0,
            previewMatchEnd: 3,
          },
        ],
      },
    ],
    matchCount: 1,
    fileCount: 1,
    isLimitHit: false,
    isTimedOut: false,
    engine: "ripgrep",
    durationMs: 5,
  };
}

function stubFetch(createResponse: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => createResponse());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(
  fetchMock: ReturnType<typeof stubFetch>,
  callIndex: number,
): URL {
  const input = fetchMock.mock.calls[callIndex]?.[0];
  if (typeof input !== "string") {
    throw new Error(`fetch call ${callIndex} has no string URL`);
  }
  return new URL(input, "http://localhost");
}

function renderContentSearch(initialProps: HookProps) {
  return renderHook((props: HookProps) => useContentSearch(props), {
    initialProps,
    wrapper: createWrapper(),
  });
}

function advance(milliseconds: number) {
  return act(() => vi.advanceTimersByTimeAsync(milliseconds));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useContentSearch debounce", () => {
  it("sends exactly one request, with the last pattern, when three patterns are typed within 300ms", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { rerender } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "" }),
    });

    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "a" }) });
    await advance(100);
    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "ab" }) });
    await advance(100);
    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "abc" }) });
    await advance(100);
    expect(fetchMock).not.toHaveBeenCalled();

    await advance(300);
    await advance(300);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestedUrl(fetchMock, 0).searchParams.get("pattern")).toBe("abc");
  });

  it("searches the initial pattern at mount without waiting for the debounce", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));

    renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "restored" }),
    });
    await advance(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestedUrl(fetchMock, 0).searchParams.get("pattern")).toBe(
      "restored",
    );
  });

  it("reports isSearching while a typed pattern waits for the debounce", async () => {
    stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { result, rerender } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "" }),
    });

    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "abc" }) });

    expect(result.current.isSearching).toBe(true);
  });
});

describe("useContentSearch request", () => {
  it("sends the workspaceId and every toggle to /api/files/grep", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));

    renderContentSearch({
      workspaceId: "ws 1",
      query: makeQuery({
        pattern: "needle",
        isRegex: true,
        isCaseSensitive: true,
        isWholeWord: true,
        includeGlobs: ["src/**"],
        excludeGlobs: ["*.test.ts"],
        maxResults: 300,
      }),
    });
    await advance(0);

    const url = requestedUrl(fetchMock, 0);
    expect(url.pathname).toBe("/api/files/grep");
    expect(url.searchParams.get("workspaceId")).toBe("ws 1");
    expect(url.searchParams.get("pattern")).toBe("needle");
    expect(url.searchParams.get("regex")).toBe("1");
    expect(url.searchParams.get("caseSensitive")).toBe("1");
    expect(url.searchParams.get("wholeWord")).toBe("1");
    expect(url.searchParams.getAll("include")).toEqual(["src/**"]);
    expect(url.searchParams.getAll("exclude")).toEqual(["*.test.ts"]);
    expect(url.searchParams.get("max")).toBe("300");
  });

  it("sends no request and returns a null outcome for an empty pattern", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "" }),
    });

    await advance(600);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.outcome).toBeNull();
  });

  it("returns the parsed outcome from a valid body", async () => {
    stubFetch(() => Response.json(makeOkOutcome("src/found.ts")));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "abc" }),
    });

    await waitFor(() =>
      expect(result.current.outcome).toEqual(makeOkOutcome("src/found.ts")),
    );
    expect(result.current.isSearching).toBe(false);
  });
});

describe("useContentSearch failures", () => {
  it("returns a failed outcome for an { error } body", async () => {
    stubFetch(() => Response.json({ error: "boom" }, { status: 500 }));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "abc" }),
    });

    await waitFor(() =>
      expect(result.current.outcome).toEqual({
        kind: "failed",
        message: "Search failed (500)",
      }),
    );
  });

  it("returns a failed outcome for a non-JSON body", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "abc" }),
    });

    await waitFor(() =>
      expect(result.current.outcome).toEqual({
        kind: "failed",
        message: "Search failed (502)",
      }),
    );
  });
});

describe("useContentSearch query switching", () => {
  it("aborts the in-flight request when the pattern changes", async () => {
    const fetchMock = stubFetch(() => new Promise<Response>(() => undefined));
    const { rerender } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "first" }),
    });
    await advance(0);
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "second" }) });
    await advance(300);

    expect(firstSignal?.aborted).toBe(true);
    expect(requestedUrl(fetchMock, 1).searchParams.get("pattern")).toBe(
      "second",
    );
  });

  it("keeps showing the previous results while a new pattern loads in the same workspace", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const query = makeQuery({ pattern: "first" });
    const { result, rerender } = renderContentSearch({
      workspaceId: "ws-1",
      query,
    });
    await advance(0);
    act(() => pendingResponses[0]?.(Response.json(makeOkOutcome("first.ts"))));
    await waitFor(() =>
      expect(result.current.outcome).toEqual(makeOkOutcome("first.ts")),
    );

    rerender({ workspaceId: "ws-1", query: makeQuery({ pattern: "second" }) });
    await advance(300);

    expect(pendingResponses).toHaveLength(2);
    expect(result.current.outcome).toEqual(makeOkOutcome("first.ts"));
    expect(result.current.isSearching).toBe(true);
  });

  it("does not show the previous workspace's results after switching workspaceId", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const query = makeQuery({ pattern: "abc" });
    const { result, rerender } = renderContentSearch({
      workspaceId: "ws-1",
      query,
    });
    await advance(0);
    act(() => pendingResponses[0]?.(Response.json(makeOkOutcome("ws1.ts"))));
    await waitFor(() =>
      expect(result.current.outcome).toEqual(makeOkOutcome("ws1.ts")),
    );

    rerender({ workspaceId: "ws-2", query });

    expect(result.current.outcome).toBeNull();
    expect(result.current.isSearching).toBe(true);
    await advance(0);
    act(() => pendingResponses[1]?.(Response.json(makeOkOutcome("ws2.ts"))));
    await waitFor(() =>
      expect(result.current.outcome).toEqual(makeOkOutcome("ws2.ts")),
    );
  });
});

describe("useContentSearch refresh", () => {
  it("re-sends the current search", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "abc" }),
    });
    await waitFor(() => expect(result.current.outcome).not.toBeNull());

    act(() => result.current.refresh());
    await advance(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends no request when workspaceId is null", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { result } = renderContentSearch({
      workspaceId: null,
      query: makeQuery({ pattern: "abc" }),
    });
    await advance(300);

    act(() => result.current.refresh());
    await advance(300);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.outcome).toBeNull();
  });

  it("sends no request when the pattern is empty", async () => {
    const fetchMock = stubFetch(() => Response.json(makeOkOutcome("a.ts")));
    const { result } = renderContentSearch({
      workspaceId: "ws-1",
      query: makeQuery({ pattern: "" }),
    });
    await advance(300);

    act(() => result.current.refresh());
    await advance(300);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
