"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"

export default function SettingsPage() {
  return (
    <AuthenticatedLayout>
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Settings — coming in Phase 7
        </p>
      </div>
    </AuthenticatedLayout>
  )
}
