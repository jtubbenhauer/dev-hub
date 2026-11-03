"use client";

import { useChatStore } from "@/stores/chat-store";
import { createContext, useContext, type ReactNode } from "react";

export interface ChatTabContextValue {
  readonly tabId: string;
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
  readonly isFocused: boolean;
  readonly isLastFocusedChat: boolean;
  readonly isVisible: boolean;
}

interface ChatTabProviderProps {
  readonly value: ChatTabContextValue;
  readonly children: ReactNode;
}

const ChatTabContext = createContext<ChatTabContextValue | null>(null);

export function ChatTabProvider({ value, children }: ChatTabProviderProps) {
  return (
    <ChatTabContext.Provider value={value}>{children}</ChatTabContext.Provider>
  );
}

export function useChatTab(): ChatTabContextValue | null {
  return useContext(ChatTabContext);
}

// Inside a tab the global selector returns a constant, so global session
// switches never re-render the tab's views.
export function useChatViewSessionId(): string | null {
  const chatTab = useChatTab();
  const globalSessionId = useChatStore((state) =>
    chatTab ? null : state.activeSessionId,
  );
  return chatTab ? chatTab.sessionId : globalSessionId;
}

export function useChatViewWorkspaceId(): string | null {
  const chatTab = useChatTab();
  const globalWorkspaceId = useChatStore((state) =>
    chatTab ? null : state.activeWorkspaceId,
  );
  return chatTab ? chatTab.workspaceId : globalWorkspaceId;
}

export function useIsChatEventTarget(): boolean {
  const chatTab = useChatTab();
  return chatTab ? chatTab.isLastFocusedChat : true;
}

export function useIsChatKeyboardOwner(): boolean {
  const chatTab = useChatTab();
  return chatTab ? chatTab.isFocused : true;
}
