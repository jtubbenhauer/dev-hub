"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { TasksPage } from "@/components/tasks/tasks-page"

export default function TasksRoute() {
  return (
    <AuthenticatedLayout>
      <TasksPage />
    </AuthenticatedLayout>
  )
}
