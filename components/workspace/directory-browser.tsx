"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Folder,
  FolderGit2,
  GitFork,
  ChevronUp,
  ArrowRight,
  Package,
  Loader2,
  Home,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface BrowseEntry {
  name: string
  path: string
  isGitRepo: boolean
  isWorktree: boolean
  hasPackageJson: boolean
}

interface BrowseResponse {
  currentPath: string
  parentPath: string
  isRoot: boolean
  entries: BrowseEntry[]
}

interface DirectoryBrowserProps {
  onSelect: (path: string) => void
  initialPath?: string
}

export function DirectoryBrowser({ onSelect, initialPath }: DirectoryBrowserProps) {
  const [browsePath, setBrowsePath] = useState(initialPath ?? "")
  const [pathInput, setPathInput] = useState("")
  const [data, setData] = useState<BrowseResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const fetchDirectory = useCallback(async (targetPath: string) => {
    setLoading(true)
    setError("")
    try {
      const params = targetPath ? `?path=${encodeURIComponent(targetPath)}` : ""
      const res = await fetch(`/api/files/browse${params}`)
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Failed to browse")
        return
      }
      const result: BrowseResponse = await res.json()
      setData(result)
      setPathInput(result.currentPath)
      setBrowsePath(result.currentPath)
    } catch {
      setError("Failed to browse directory")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDirectory(initialPath ?? "")
  }, [fetchDirectory, initialPath])

  function handleNavigate(targetPath: string) {
    fetchDirectory(targetPath)
  }

  function handlePathSubmit() {
    if (pathInput.trim()) {
      fetchDirectory(pathInput.trim())
    }
  }

  function handleEntryDoubleClick(entry: BrowseEntry) {
    handleNavigate(entry.path)
  }

  function getEntryIcon(entry: BrowseEntry) {
    if (entry.isWorktree) return <GitFork className="h-4 w-4 text-purple-500 shrink-0" />
    if (entry.isGitRepo) return <FolderGit2 className="h-4 w-4 text-orange-500 shrink-0" />
    return <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Path input bar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => fetchDirectory("")}
          title="Home directory"
        >
          <Home className="h-4 w-4" />
        </Button>
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handlePathSubmit()
          }}
          placeholder="/path/to/directory"
          className="font-mono text-sm"
        />
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={handlePathSubmit}
          title="Go to path"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Directory listing */}
      <ScrollArea className="h-[300px] rounded-md border">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="p-1">
            {/* Parent directory */}
            {!data.isRoot && (
              <button
                onClick={() => handleNavigate(data.parentPath)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent text-left"
              >
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">..</span>
              </button>
            )}

            {data.entries.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                No subdirectories
              </div>
            ) : (
              data.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleNavigate(entry.path)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent text-left group",
                    (entry.isGitRepo || entry.isWorktree) && "font-medium"
                  )}
                >
                  {getEntryIcon(entry)}
                  <span className="truncate flex-1">{entry.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {entry.hasPackageJson && (
                      <Package className="h-3 w-3 text-green-500" title="Has package.json" />
                    )}
                    {(entry.isGitRepo || entry.isWorktree) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(entry.path)
                        }}
                      >
                        Select
                      </Button>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </ScrollArea>

      {/* Select current directory button */}
      <Button
        onClick={() => onSelect(browsePath)}
        disabled={!browsePath}
        className="w-full"
      >
        Select Current Directory
        <span className="ml-2 max-w-[200px] truncate text-xs opacity-70 font-mono">
          {browsePath}
        </span>
      </Button>
    </div>
  )
}
