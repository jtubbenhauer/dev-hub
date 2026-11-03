"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { WorkspaceChatEffectsHost } from "@/components/chat/workspace-chat-effects-host";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Suspense } from "react";

function LegacyChatPage() {
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  return (
    <>
      <WorkspaceChatEffectsHost />
      <ChatInterface
        tabId="legacy-chat-page"
        workspaceId={activeWorkspaceId}
        sessionId={activeSessionId}
        isFocused
        isLastFocusedChat
        isVisible
        legacyPageMode
      />
      <ChatFileDialog />
    </>
  );
}

export default function ChatPage() {
  return (
    <AuthenticatedLayout>
      <Suspense fallback={null}>
        <LegacyChatPage />
      </Suspense>
    </AuthenticatedLayout>
  );
}
