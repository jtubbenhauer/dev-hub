"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"

export default function CommandsPage() {
  return (
    <AuthenticatedLayout>
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Command Runner — coming in Phase 5
        </p>
      </div>
    </AuthenticatedLayout>
  )
}
