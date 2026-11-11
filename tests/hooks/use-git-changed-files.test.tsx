import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGitChangedFiles } from "@/hooks/use-git";

const COMMITTED_CHANGES_URL =
  "/api/workspaces/ws-1/git?action=changed-files&baseRef=main&currentRef=HEAD";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return QueryWrapper;
}

function stubGitApi() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? Response.json({ ok: true }) : Response.json([]),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGitChangedFiles", () => {
  it("asks for the files changed between baseRef and currentRef", async () => {
    // Given
    const fetchMock = stubGitApi();

    // When
    const { result } = renderHook(
      () => useGitChangedFiles("ws-1", "main", "HEAD"),
      { wrapper: createWrapper() },
    );

    // Then
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(COMMITTED_CHANGES_URL);
  });
});
