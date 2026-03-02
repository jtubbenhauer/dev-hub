"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { SystemStatsCards } from "@/components/dashboard/system-stats"
import { ProcessList } from "@/components/dashboard/process-list"
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { ClickUpTasks } from "@/components/dashboard/clickup-tasks"

export default function DashboardPage() {
  return (
    <AuthenticatedLayout>
      <div className="h-full overflow-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>

        {/* System stats cards with sparklines */}
        <section>
          <SystemStatsCards />
        </section>

        {/* Quick action buttons */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Quick Actions</h2>
          <QuickActions />
        </section>

        {/* Workspaces + ClickUp tasks side by side on large screens */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Workspaces</h2>
            <WorkspaceOverview />
          </section>

          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">My Tasks</h2>
            <ClickUpTasks />
          </section>
        </div>

        {/* Process list below */}
        <section>
          <ProcessList />
        </section>
      </div>
    </AuthenticatedLayout>
  )
}
