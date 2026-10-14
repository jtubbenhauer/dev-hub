"use client";

import { useId, type ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceEngine } from "@/hooks/use-workspace-engine";
import { CHAT_ENGINES, type ChatEngine } from "@/lib/engine/types";

export const NEW_CHAT_ENGINE_LABELS: Record<ChatEngine, string> = {
  opencode: "OpenCode",
  omo: "OMO Native",
};

interface NewChatEngineMenuItemsProps {
  workspaceId: string | null;
  onSelectEngine: (engine: ChatEngine) => void;
}

// Render this inside menu content: the default-engine lookup then only runs
// while the menu is open.
export function NewChatEngineMenuItems({
  workspaceId,
  onSelectEngine,
}: NewChatEngineMenuItemsProps) {
  const defaultMarkerIdPrefix = useId();
  const { engine: defaultEngine, isLoading } = useWorkspaceEngine(workspaceId);

  return (
    <>
      {CHAT_ENGINES.map((engine) => {
        const isDefault = !isLoading && engine === defaultEngine;
        const defaultMarkerId = `${defaultMarkerIdPrefix}-${engine}-default`;
        return (
          <DropdownMenuItem
            key={engine}
            aria-describedby={isDefault ? defaultMarkerId : undefined}
            className="pointer-coarse:py-2.5"
            onSelect={() => onSelectEngine(engine)}
          >
            <span className="flex-1">{NEW_CHAT_ENGINE_LABELS[engine]}</span>
            {isDefault && (
              <span
                id={defaultMarkerId}
                aria-hidden
                className="text-muted-foreground text-xs"
              >
                Default
              </span>
            )}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

interface NewChatMenuProps {
  workspaceId: string | null;
  onCreate: (engine: ChatEngine) => void;
  children: ReactElement;
  align?: "start" | "center" | "end";
}

export function NewChatMenu({
  workspaceId,
  onCreate,
  children,
  align = "end",
}: NewChatMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          New chat
        </DropdownMenuLabel>
        <NewChatEngineMenuItems
          workspaceId={workspaceId}
          onSelectEngine={onCreate}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
