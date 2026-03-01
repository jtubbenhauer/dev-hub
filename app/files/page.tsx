"use client"

import { useCallback, useState } from "react"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { FileTree } from "@/components/editor/file-tree"
import { CodeEditor } from "@/components/editor/code-editor"
import { FileTabs } from "@/components/editor/file-tabs"
import { VimToggle } from "@/components/editor/vim-toggle"
import { useEditorStore } from "@/stores/editor-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { PanelLeftClose, PanelLeft, FileCode2 } from "lucide-react"
import { toast } from "sonner"

export default function FilesPage() {
  const {
    openFiles,
    activeFilePath,
    isFileTreeOpen,
    toggleFileTree,
    updateFileContent,
    markFileSaved,
  } = useEditorStore()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const isMobile = useIsMobile()
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false)

  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  const handleSave = useCallback(async () => {
    if (!activeFile || !activeWorkspaceId) return

    try {
      const response = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          path: activeFile.path,
          content: activeFile.content,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error ?? "Save failed")
      }

      markFileSaved(activeFile.path)
      toast.success("File saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save file")
    }
  }, [activeFile, activeWorkspaceId, markFileSaved])

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeFilePath) {
        updateFileContent(activeFilePath, content)
      }
    },
    [activeFilePath, updateFileContent]
  )

  return (
    <AuthenticatedLayout>
      <div className="flex h-full min-h-0">
        {/* File tree sidebar - desktop */}
        {!isMobile && (
          <div
            className={cn(
              "border-r bg-muted/30 transition-all duration-200",
              isFileTreeOpen ? "w-60 min-w-[240px]" : "w-0 min-w-0 overflow-hidden"
            )}
          >
            <FileTree />
          </div>
        )}

        {/* File tree sidebar - mobile sheet */}
        {isMobile && (
          <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
            <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
              <SheetHeader className="sr-only">
                <SheetTitle>Files</SheetTitle>
              </SheetHeader>
              <FileTree />
            </SheetContent>
          </Sheet>
        )}

        {/* Editor area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Toolbar */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/30 px-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={isMobile ? () => setMobileTreeOpen(true) : toggleFileTree}
              >
                {!isMobile && isFileTreeOpen ? (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeft className="h-3.5 w-3.5" />
                )}
              </Button>

              {activeFile && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-mono">{activeFile.path}</span>
                  {activeFile.isDirty && (
                    <span className="text-orange-400">(unsaved)</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activeFile && (
                <span className="text-xs text-muted-foreground">
                  {activeFile.language}
                </span>
              )}
              <VimToggle />
            </div>
          </div>

          {/* File tabs */}
          <FileTabs />

          {/* Editor content */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeFile ? (
              <CodeEditor
                content={activeFile.content}
                language={activeFile.language}
                onChange={handleContentChange}
                onSave={handleSave}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <FileCode2 className="h-12 w-12" />
                <p className="text-sm">
                  {activeWorkspaceId
                    ? "Select a file from the tree to edit"
                    : "Select a workspace to browse files"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  )
}
