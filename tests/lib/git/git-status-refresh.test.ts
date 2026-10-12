import { describe, expect, it, vi } from "vitest";
import {
  requestGitStatusRefresh,
  subscribeToGitStatusRefresh,
} from "@/lib/git/git-status-refresh";

describe("git status refresh", () => {
  it("notifies every subscriber with the workspace id", () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = subscribeToGitStatusRefresh(firstListener);
    const unsubscribeSecond = subscribeToGitStatusRefresh(secondListener);

    requestGitStatusRefresh("ws-1");

    expect(firstListener).toHaveBeenCalledExactlyOnceWith("ws-1");
    expect(secondListener).toHaveBeenCalledExactlyOnceWith("ws-1");
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToGitStatusRefresh(listener);
    unsubscribe();

    requestGitStatusRefresh("ws-1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing without subscribers", () => {
    expect(() => requestGitStatusRefresh("ws-1")).not.toThrow();
  });
});
