"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToGitStatusRefresh } from "@/lib/git/git-status-refresh";

export function GitStatusRefreshSubscriber() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      subscribeToGitStatusRefresh((workspaceId) => {
        void queryClient.invalidateQueries({
          queryKey: ["git-status", workspaceId],
        });
      }),
    [queryClient],
  );

  return null;
}
