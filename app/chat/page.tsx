"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { Suspense } from "react";

export default function ChatPage() {
  return (
    <AuthenticatedLayout>
      <Suspense fallback={null}>
        <ChatInterface />
        <ChatFileDialog />
      </Suspense>
    </AuthenticatedLayout>
  );
}
