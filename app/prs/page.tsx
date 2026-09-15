"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { PrPanel } from "@/components/git/pr-panel";

export default function PrsPage() {
  return (
    <AuthenticatedLayout>
      <PrPanel />
    </AuthenticatedLayout>
  );
}
