"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  FolderPlus,
  GitFork,
  Globe,
  MessageSquarePlus,
  SquareTerminal,
} from "lucide-react";
import { NEW_CHAT_ENGINE_LABELS } from "@/components/chat/new-chat-menu";
import type { PaletteCommand } from "@/components/providers/command-palette-provider";
import { useCommand } from "@/hooks/use-command";
import { CHAT_ENGINES, type ChatEngine } from "@/lib/engine/types";
import {
  createNewChatInWorkbench,
  openTerminalInWorkbench,
  type WorkbenchNavigate,
} from "@/lib/workbench/open-in-workbench";
import { findWorktreeParentRepo } from "@/lib/workspaces/worktree-parent-repo";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import {
  useWorkspaceDialogStore,
  type WorkspaceDialog,
} from "@/stores/workspace-dialog-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

function getActiveWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId;
}

function openWorkspaceDialog(dialog: WorkspaceDialog): void {
  useWorkspaceDialogStore.getState().open(dialog);
}

function openCreateWorktreeDialog(): void {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
  const repo = findWorktreeParentRepo(workspaces, activeWorkspaceId);
  openWorkspaceDialog({
    kind: "create-worktree",
    initialRepoId: repo?.id ?? null,
  });
}

// Same as picking an engine in the session list's New Chat menu.
function openNewChatWithEngine(
  engine: ChatEngine,
  navigate: WorkbenchNavigate,
): void {
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId !== null) {
    useNewChatEngineStore.getState().setNewChatEngine(workspaceId, engine);
  }
  void createNewChatInWorkbench({ workspaceId, navigate });
}

// Palette commands that work from every page. The workbench:* ids match the
// workbench leader actions, so on the workbench the palette shows their keys.
export function AppCommands() {
  const router = useRouter();

  const commands = useMemo<PaletteCommand[]>(() => {
    const navigate = (href: string) => router.push(href);
    return [
      {
        id: "workbench:new-chat",
        label: "New chat",
        group: "Workbench",
        icon: MessageSquarePlus,
        onSelect: () =>
          void createNewChatInWorkbench({
            workspaceId: getActiveWorkspaceId(),
            navigate,
          }),
      },
      ...CHAT_ENGINES.map((engine) => ({
        id: `workbench:new-chat:${engine}`,
        label: `New chat (${NEW_CHAT_ENGINE_LABELS[engine]})`,
        group: "Workbench",
        icon: MessageSquarePlus,
        onSelect: () => openNewChatWithEngine(engine, navigate),
      })),
      {
        id: "workbench:new-terminal",
        label: "New terminal",
        group: "Workbench",
        icon: SquareTerminal,
        onSelect: () =>
          openTerminalInWorkbench({
            workspaceId: getActiveWorkspaceId(),
            navigate,
          }),
      },
      {
        id: "workspace:create-worktree",
        label: "Create worktree",
        group: "Workspaces",
        icon: GitFork,
        keywords: ["add worktree", "new worktree", "new branch"],
        onSelect: openCreateWorktreeDialog,
      },
      {
        id: "workspace:add-workspace",
        label: "Add workspace",
        group: "Workspaces",
        icon: FolderPlus,
        keywords: ["add repo", "add folder", "open folder"],
        onSelect: () => openWorkspaceDialog({ kind: "add-workspace" }),
      },
      {
        id: "workspace:clone-repo",
        label: "Clone repo",
        group: "Workspaces",
        icon: Download,
        keywords: ["clone repository", "git clone"],
        onSelect: () => openWorkspaceDialog({ kind: "clone-repo" }),
      },
      {
        id: "workspace:connect-remote",
        label: "Connect remote workspace",
        group: "Workspaces",
        icon: Globe,
        keywords: ["remote agent", "add remote"],
        onSelect: () => openWorkspaceDialog({ kind: "connect-remote" }),
      },
    ];
  }, [router]);

  useCommand(commands);
  return null;
}
