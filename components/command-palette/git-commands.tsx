"use client";

import { useEffect } from "react";
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useGitFetch, useGitPull, useGitPush } from "@/hooks/use-git";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Fetch, pull and push the active workspace from any page. The ids match the
// git page's leader actions, so on that page the palette shows their keys.
export function GitCommands() {
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const { mutate: fetchRemote } = useGitFetch(activeWorkspaceId);
  const { mutate: pullRemote } = useGitPull(activeWorkspaceId);
  const { mutate: pushRemote } = useGitPush(activeWorkspaceId);
  const { registerCommands } = useCommandPalette();

  useEffect(() => {
    if (activeWorkspaceId === null) return;
    return registerCommands([
      {
        id: "git:fetch",
        label: "Fetch from remote",
        group: "Git",
        icon: RefreshCw,
        onSelect: () => fetchRemote({ action: "fetch" }),
      },
      {
        id: "git:pull",
        label: "Pull from remote",
        group: "Git",
        icon: ArrowDownToLine,
        onSelect: () => pullRemote({ action: "pull" }),
      },
      {
        id: "git:push",
        label: "Push to remote",
        group: "Git",
        icon: ArrowUpFromLine,
        onSelect: () => pushRemote({ action: "push" }),
      },
    ]);
  }, [
    activeWorkspaceId,
    registerCommands,
    fetchRemote,
    pullRemote,
    pushRemote,
  ]);

  return null;
}
