"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { ChatInterface } from "@/components/chat/chat-interface";
import { Suspense } from "react";

export default function ChatPage() {
  return (
    <AuthenticatedLayout>
      <Suspense fallback={null}>
        <ChatInterface />
      </Suspense>
    </AuthenticatedLayout>
  );
}
