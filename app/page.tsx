"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FolderGit2, Terminal, MessageSquare } from "lucide-react"
import Link from "next/link"

export default function DashboardPage() {
  const { workspaces } = useWorkspaceStore()

  return (
    <AuthenticatedLayout>
      <div className="h-full overflow-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>

        <section>
          <h2 className="text-lg font-semibold mb-3">Workspaces</h2>
          {workspaces.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-8">
                <FolderGit2 className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No workspaces registered yet.
                </p>
                <Link
                  href="/workspaces"
                  className="text-primary hover:underline"
                >
                  Add your first workspace
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace) => (
                <Card key={workspace.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {workspace.name}
                      </CardTitle>
                      <Badge variant="secondary">{workspace.type}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground truncate mb-3">
                      {workspace.path}
                    </p>
                    <div className="flex gap-2">
                      <Link
                        href="/chat"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Chat
                      </Link>
                      <Link
                        href="/files"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <FolderGit2 className="h-3 w-3" />
                        Files
                      </Link>
                      <Link
                        href="/commands"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Terminal className="h-3 w-3" />
                        Commands
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </AuthenticatedLayout>
  )
}
