"use client";

import { useCommand } from "@/hooks/use-command";
import { useLeaderAction } from "@/hooks/use-leader-action";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import {
  Brain,
  Clock,
  Coins,
  ListTodo,
  PanelRight,
  Plus,
  ScrollText,
  Wrench,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useMemo, useState } from "react";
import { useSplitPanelStore } from "@/stores/split-panel-store";

interface ChatCommandRefs {
  handleCreateSession: RefObject<() => void>;
  setIsPlanPanelOpen: RefObject<Dispatch<SetStateAction<boolean>>>;
  setIsSessionListOpen: RefObject<Dispatch<SetStateAction<boolean>>>;
  setIsModelSelectorOpen: RefObject<Dispatch<SetStateAction<boolean>>>;
  setIsAgentSelectorOpen: RefObject<Dispatch<SetStateAction<boolean>>>;
  setIsTaskPanelOpen: RefObject<Dispatch<SetStateAction<boolean>>>;
  promptInput: RefObject<PromptInputHandle | null>;
}

interface ChatCommandLabels {
  isPlanPanelOpen: boolean;
  isTaskPanelOpen: boolean;
  isSplitPanelOpen: boolean;
  showThinking: boolean;
  showToolCalls: boolean;
  showTokens: boolean;
  showTimestamps: boolean;
}

interface ChatCommandSetters {
  setShowThinking: Dispatch<SetStateAction<boolean>>;
  setShowToolCalls: Dispatch<SetStateAction<boolean>>;
  setShowTokens: Dispatch<SetStateAction<boolean>>;
  setShowTimestamps: Dispatch<SetStateAction<boolean>>;
}

export function useChatCommands(
  refs: ChatCommandRefs,
  labels: ChatCommandLabels,
  setters: ChatCommandSetters,
) {
  const [isVariantSelectorOpen, setIsVariantSelectorOpen] = useState(false);

  const {
    setShowThinking,
    setShowToolCalls,
    setShowTokens,
    setShowTimestamps,
  } = setters;

  // React useState setters are stable — no refs needed
  const toggleThinking = useCallback(() => {
    setShowThinking((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-thinking", String(next));
      return next;
    });
  }, [setShowThinking]);

  const toggleToolCalls = useCallback(() => {
    setShowToolCalls((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-tool-calls", String(next));
      return next;
    });
  }, [setShowToolCalls]);

  const toggleTokens = useCallback(() => {
    setShowTokens((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-tokens", String(next));
      return next;
    });
  }, [setShowTokens]);

  const toggleTimestamps = useCallback(() => {
    setShowTimestamps((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-timestamps", String(next));
      return next;
    });
  }, [setShowTimestamps]);

  const chatCommands = useMemo(
    () => [
      {
        id: "chat:toggle-plan-panel",
        label: labels.isPlanPanelOpen ? "Hide Plan Panel" : "Show Plan Panel",
        group: "Chat",
        icon: ScrollText,
        onSelect: () => refs.setIsPlanPanelOpen.current((prev) => !prev),
      },
      {
        id: "chat:new-session",
        label: "New Session",
        group: "Chat",
        icon: Plus,
        onSelect: () => refs.handleCreateSession.current(),
      },
      {
        id: "chat:toggle-task-panel",
        label: labels.isTaskPanelOpen ? "Hide Side Panel" : "Show Side Panel",
        group: "Chat",
        icon: ListTodo,
        onSelect: () =>
          refs.setIsTaskPanelOpen.current((prev) => {
            const next = !prev;
            localStorage.setItem("dev-hub:chat-task-panel", String(next));
            return next;
          }),
      },
      {
        id: "chat:toggle-split-panel",
        label: labels.isSplitPanelOpen ? "Hide Split View" : "Show Split View",
        group: "Chat",
        icon: PanelRight,
        onSelect: () => {
          useSplitPanelStore.getState().togglePanel();
          if (useSplitPanelStore.getState().isOpen) {
            refs.setIsTaskPanelOpen.current((prev) => {
              if (prev)
                localStorage.setItem("dev-hub:chat-task-panel", "false");
              return false;
            });
          }
        },
      },
      {
        id: "chat:toggle-thinking",
        label: labels.showThinking ? "Hide Thinking" : "Show Thinking",
        group: "Chat",
        icon: Brain,
        onSelect: toggleThinking,
      },
      {
        id: "chat:toggle-tool-calls",
        label: labels.showToolCalls ? "Hide Tool Calls" : "Show Tool Calls",
        group: "Chat",
        icon: Wrench,
        onSelect: toggleToolCalls,
      },
      {
        id: "chat:toggle-tokens",
        label: labels.showTokens ? "Hide Token Usage" : "Show Token Usage",
        group: "Chat",
        icon: Coins,
        onSelect: toggleTokens,
      },
      {
        id: "chat:toggle-timestamps",
        label: labels.showTimestamps ? "Hide Timestamps" : "Show Timestamps",
        group: "Chat",
        icon: Clock,
        onSelect: toggleTimestamps,
      },
    ],
    [
      toggleThinking,
      toggleToolCalls,
      toggleTokens,
      toggleTimestamps,
      labels.showThinking,
      labels.showToolCalls,
      labels.showTokens,
      labels.showTimestamps,
      labels.isPlanPanelOpen,
      labels.isTaskPanelOpen,
      labels.isSplitPanelOpen,
      refs.setIsPlanPanelOpen,
      refs.handleCreateSession,
      refs.setIsTaskPanelOpen,
    ],
  );

  useCommand(chatCommands);

  const chatLeaderActions = useMemo(() => {
    const actions = [
      {
        action: {
          id: "chat:switch-model",
          label: "Switch model",
          page: "chat" as const,
        },
        handler: () => refs.setIsModelSelectorOpen.current(true),
      },
      {
        action: {
          id: "chat:switch-agent",
          label: "Switch agent",
          page: "chat" as const,
        },
        handler: () => refs.setIsAgentSelectorOpen.current(true),
      },
      {
        action: {
          id: "chat:new-session",
          label: "New session",
          page: "chat" as const,
        },
        handler: () => refs.handleCreateSession.current(),
      },
      {
        action: {
          id: "chat:toggle-sessions",
          label: "Toggle session list",
          page: "chat" as const,
        },
        handler: () => refs.setIsSessionListOpen.current((prev) => !prev),
      },
      {
        action: {
          id: "chat:toggle-plan",
          label: "Toggle plan panel",
          page: "chat" as const,
        },
        handler: () => refs.setIsPlanPanelOpen.current((prev) => !prev),
      },
      {
        action: {
          id: "chat:toggle-tasks",
          label: "Toggle side panel",
          page: "chat" as const,
        },
        handler: () =>
          refs.setIsTaskPanelOpen.current((prev) => {
            const next = !prev;
            localStorage.setItem("dev-hub:chat-task-panel", String(next));
            return next;
          }),
      },
      {
        action: {
          id: "chat:toggle-thinking",
          label: "Toggle thinking",
          page: "chat" as const,
        },
        handler: toggleThinking,
      },
      {
        action: {
          id: "chat:toggle-tool-calls",
          label: "Toggle tool calls",
          page: "chat" as const,
        },
        handler: toggleToolCalls,
      },
      {
        action: {
          id: "chat:toggle-tokens",
          label: "Toggle token usage",
          page: "chat" as const,
        },
        handler: toggleTokens,
      },
      {
        action: {
          id: "chat:toggle-timestamps",
          label: "Toggle timestamps",
          page: "chat" as const,
        },
        handler: toggleTimestamps,
      },
      {
        action: {
          id: "chat:focus-prompt",
          label: "Focus prompt input",
          page: "chat" as const,
        },
        handler: () => refs.promptInput.current?.focus(),
      },
      {
        action: {
          id: "chat:toggle-variant",
          label: "Toggle variant selector",
          page: "chat" as const,
        },
        handler: () => setIsVariantSelectorOpen((prev) => !prev),
      },
    ];

    return actions;
  }, [
    toggleThinking,
    toggleToolCalls,
    toggleTokens,
    toggleTimestamps,
    refs.setIsModelSelectorOpen,
    refs.setIsAgentSelectorOpen,
    refs.handleCreateSession,
    refs.setIsSessionListOpen,
    refs.setIsPlanPanelOpen,
    refs.setIsTaskPanelOpen,
    refs.promptInput,
  ]);

  useLeaderAction(chatLeaderActions);

  return { isVariantSelectorOpen, setIsVariantSelectorOpen };
}
