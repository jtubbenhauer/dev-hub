import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useGitHubRepoPrs } from "@/hooks/use-github-repo-prs";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockPrs = [
  {
    number: 42,
    title: "Add new feature",
    state: "open" as const,
    draft: false,
    merged_at: null,
    user: { login: "alice", avatar_url: "https://example.com/alice.png" },
    head: { ref: "feature/add-new" },
  },
  {
    number: 43,
    title: "Fix critical bug",
    state: "open" as const,
    draft: true,
    merged_at: null,
    user: { login: "bob", avatar_url: "https://example.com/bob.png" },
    head: { ref: "fix/critical-bug" },
  },
];

describe("useGitHubRepoPrs", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("fetches PRs from the correct endpoint with state=open by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockPrs,
    });

    const { result } = renderHook(() => useGitHubRepoPrs("myorg", "myrepo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/repos/myorg/myrepo/pulls?state=open&per_page=20",
      undefined,
    );
  });

  it("returns PR data with correct shape", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockPrs,
    });

    const { result } = renderHook(() => useGitHubRepoPrs("myorg", "myrepo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data;
    expect(data).toBeDefined();
    expect(data![0]).toMatchObject({
      number: 42,
      title: "Add new feature",
      state: "open",
      draft: false,
      merged_at: null,
      user: { login: "alice", avatar_url: "https://example.com/alice.png" },
      head: { ref: "feature/add-new" },
    });
  });

  it("caps results at 20 items even if API returns more", async () => {
    const manyPrs = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      state: "open" as const,
      draft: false,
      merged_at: null,
      user: { login: "user", avatar_url: "https://example.com/user.png" },
      head: { ref: `branch-${i + 1}` },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => manyPrs,
    });

    const { result } = renderHook(() => useGitHubRepoPrs("myorg", "myrepo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(20);
  });

  it("uses the provided state option in the URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [],
    });

    const { result } = renderHook(
      () => useGitHubRepoPrs("myorg", "myrepo", { state: "closed" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/repos/myorg/myrepo/pulls?state=closed&per_page=20",
      undefined,
    );
  });

  it("does NOT fetch when owner is empty string", () => {
    const { result } = renderHook(() => useGitHubRepoPrs("", "myrepo"), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT fetch when repo is empty string", () => {
    const { result } = renderHook(() => useGitHubRepoPrs("myorg", ""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("filters results by title when search option is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockPrs,
    });

    const { result } = renderHook(
      () => useGitHubRepoPrs("myorg", "myrepo", { search: "fix" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].title).toBe("Fix critical bug");
  });

  it("filters results by PR number when search matches number", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockPrs,
    });

    const { result } = renderHook(
      () => useGitHubRepoPrs("myorg", "myrepo", { search: "42" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].number).toBe(42);
  });

  it("uses queryKey including state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockPrs,
    });

    const { result } = renderHook(() => useGitHubRepoPrs("myorg", "myrepo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
  });
});
