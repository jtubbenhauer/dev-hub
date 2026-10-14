"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHAT_ENGINE_LABELS,
  getWorkspaceEngineOverride,
  useChatEngineSetting,
} from "@/hooks/use-chat-engine";
import {
  CHAT_ENGINES,
  isChatEngine,
  type ChatEngine,
} from "@/lib/engine/types";
import type { Workspace } from "@/types";

const INHERIT_ENGINE_VALUE = "inherit";

interface EngineOverrideChange {
  readonly workspaceId: string;
  readonly engineOverride: ChatEngine | null;
  readonly nextEngine: ChatEngine;
}

async function saveEngineOverride(
  change: EngineOverrideChange,
): Promise<Workspace> {
  const response = await fetch(`/api/workspaces/${change.workspaceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: change.engineOverride }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update chat engine");
  }
  return response.json();
}

export function WorkspaceEngineEditor({ workspace }: { workspace: Workspace }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          title="Chat engine"
          aria-label="Chat engine"
          onClick={(event) => event.stopPropagation()}
        >
          <Bot className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <WorkspaceEngineForm workspace={workspace} />
      </PopoverContent>
    </Popover>
  );
}

function WorkspaceEngineForm({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const { chatEngine: defaultEngine, isLoading } = useChatEngineSetting();
  const engineOverride = getWorkspaceEngineOverride(workspace);

  const updateMutation = useMutation({
    mutationFn: saveEngineOverride,
    onSuccess: (updatedWorkspace, change) => {
      queryClient.setQueryData<Workspace[]>(["workspaces"], (workspaces) =>
        workspaces?.map((item) =>
          item.id === updatedWorkspace.id ? updatedWorkspace : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(
        `New chats in this workspace default to ${CHAT_ENGINE_LABELS[change.nextEngine]}`,
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const pendingChange = updateMutation.isPending
    ? updateMutation.variables
    : undefined;
  const displayedOverride = pendingChange
    ? pendingChange.engineOverride
    : engineOverride;

  const handleEngineChange = (value: string) => {
    const nextOverride = isChatEngine(value) ? value : null;
    if (nextOverride === engineOverride) return;
    updateMutation.mutate({
      workspaceId: workspace.id,
      engineOverride: nextOverride,
      nextEngine: nextOverride ?? defaultEngine,
    });
  };

  const selectId = `workspace-engine-${workspace.id}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Default engine for new chats</p>
        <p className="text-muted-foreground text-xs">
          Existing chats keep the engine they started on.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={selectId} className="text-xs">
          Engine
        </Label>
        <Select
          value={displayedOverride ?? INHERIT_ENGINE_VALUE}
          onValueChange={handleEngineChange}
          disabled={isLoading || updateMutation.isPending}
        >
          <SelectTrigger id={selectId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_ENGINE_VALUE}>
              Inherit default ({CHAT_ENGINE_LABELS[defaultEngine]})
            </SelectItem>
            {CHAT_ENGINES.map((engine) => (
              <SelectItem key={engine} value={engine}>
                {CHAT_ENGINE_LABELS[engine]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
