"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";

const WorkbenchView = dynamic(
  () =>
    import("@/components/workbench/workbench-view").then(
      (m) => m.WorkbenchView,
    ),
  { ssr: false },
);

export default function WorkbenchPage() {
  return (
    <AuthenticatedLayout>
      <Suspense fallback={null}>
        <WorkbenchView />
        <ChatFileDialog />
      </Suspense>
    </AuthenticatedLayout>
  );
}
