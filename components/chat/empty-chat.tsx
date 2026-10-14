"use client";

import { NEW_CHAT_ENGINE_LABELS } from "@/components/chat/new-chat-menu";
import { Button } from "@/components/ui/button";
import {
  useActiveChatEngine,
  useNewChatEngine,
} from "@/hooks/use-active-chat-engine";
import { CHAT_ENGINES } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";

const suggestions = [
  "What files are in this project?",
  "Explain the project structure",
  "Find and fix any bugs",
  "Write tests for the main module",
];

interface EmptyChatProps {
  onSend: (text: string) => void;
}

export function EmptyChat({ onSend }: EmptyChatProps) {
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const hasActiveSession = useChatStore(
    (state) => state.activeSessionId !== null,
  );
  const { engine, isLoading } = useActiveChatEngine(activeWorkspaceId);
  const engineName = isLoading ? "" : engine === "omo" ? "OmO " : "OpenCode ";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Start a conversation</h2>
        {activeWorkspaceId !== null && !hasActiveSession && (
          <NewChatEngineToggle workspaceId={activeWorkspaceId} />
        )}
        <p className="text-muted-foreground mt-1 text-sm">
          Ask {engineName}anything about your project
        </p>
      </div>
      <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            className="h-auto px-4 py-3 text-left text-sm whitespace-normal"
            onClick={() => onSend(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}

function NewChatEngineToggle({ workspaceId }: { workspaceId: string }) {
  const { engine: selectedEngine, isLoading } = useNewChatEngine(workspaceId);
  if (isLoading) return null;

  return (
    <div
      role="group"
      aria-label="Chat engine"
      className="bg-background dark:border-input dark:bg-input/30 mx-auto mt-3 mb-2 flex w-fit items-center gap-0.5 rounded-md border p-0.5 shadow-xs"
    >
      {CHAT_ENGINES.map((engineOption) => {
        const isSelected = engineOption === selectedEngine;
        return (
          <button
            key={engineOption}
            type="button"
            aria-pressed={isSelected}
            onClick={() =>
              useNewChatEngineStore
                .getState()
                .setNewChatEngine(workspaceId, engineOption)
            }
            className={cn(
              "focus-visible:ring-ring/50 h-7 rounded-sm px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] pointer-coarse:h-9 pointer-coarse:px-3.5",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {NEW_CHAT_ENGINE_LABELS[engineOption]}
          </button>
        );
      })}
    </div>
  );
}
