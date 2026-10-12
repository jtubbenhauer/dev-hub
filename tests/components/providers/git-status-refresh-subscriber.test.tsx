import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitStatusRefreshSubscriber } from "@/components/providers/git-status-refresh-subscriber";
import { requestGitStatusRefresh } from "@/lib/git/git-status-refresh";

describe("GitStatusRefreshSubscriber", () => {
  it("invalidates git status for the requested workspace while mounted", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <GitStatusRefreshSubscriber />
      </QueryClientProvider>,
    );

    requestGitStatusRefresh("ws-1");
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["git-status", "ws-1"],
    });

    unmount();
    requestGitStatusRefresh("ws-2");
    expect(invalidateQueries).toHaveBeenCalledOnce();
  });

  it("marks a cached git status query invalid", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["git-status", "ws-1"], { files: [] });
    queryClient.setQueryData(["git-status", "ws-2"], { files: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GitStatusRefreshSubscriber />
      </QueryClientProvider>,
    );

    requestGitStatusRefresh("ws-1");

    const queryCache = queryClient.getQueryCache();
    expect(
      queryCache.find({ queryKey: ["git-status", "ws-1"] })?.state,
    ).toMatchObject({ isInvalidated: true });
    expect(
      queryCache.find({ queryKey: ["git-status", "ws-2"] })?.state,
    ).toMatchObject({ isInvalidated: false });
  });
});
