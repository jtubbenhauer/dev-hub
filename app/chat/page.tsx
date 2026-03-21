"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { ChatInterface } from "@/components/chat/chat-interface";

export default function ChatPage() {
  return (
    <AuthenticatedLayout>
      <ChatInterface />
    </AuthenticatedLayout>
  );
}
