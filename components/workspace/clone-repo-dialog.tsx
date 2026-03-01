"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Download,
  Loader2,
  FolderOpen,
} from "lucide-react"
import { useCloneRepo } from "@/hooks/use-git"

/**
 * Extract repo name from a git URL for preview purposes.
 * Handles https and git@ URLs.
 */
function extractRepoName(url: string): string {
  try {
    const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "")
    const parts = cleaned.split(/[/:]/)
    return parts[parts.length - 1] || ""
  } catch {
    return ""
  }
}

/**
 * Extract owner/repo from a git URL for display purposes.
 */
function extractOwnerRepo(url: string): string {
  try {
    const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "")

    // Handle git@github.com:owner/repo
    const sshMatch = cleaned.match(/git@[^:]+:(.+)/)
    if (sshMatch) return sshMatch[1]

    // Handle https://github.com/owner/repo
    const httpsMatch = cleaned.match(/https?:\/\/[^/]+\/(.+)/)
    if (httpsMatch) return httpsMatch[1]

    return ""
  } catch {
    return ""
  }
}

const DEFAULT_BASE_DIR = "~/dev"

export function CloneRepoDialog() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [customDir, setCustomDir] = useState("")
  const [customName, setCustomName] = useState("")
  const [shallowClone, setShallowClone] = useState(false)
  const [shallowDepth, setShallowDepth] = useState("1")

  const cloneRepo = useCloneRepo()

  const repoName = useMemo(() => extractRepoName(url), [url])
  const ownerRepo = useMemo(() => extractOwnerRepo(url), [url])

  // Preview of where it will be cloned
  const targetPath = useMemo(() => {
    if (customDir) return customDir
    if (!repoName) return ""
    return `${DEFAULT_BASE_DIR}/${repoName}`
  }, [customDir, repoName])

  // Display name preview
  const displayName = useMemo(() => {
    return customName || repoName
  }, [customName, repoName])

  const isValidUrl = useMemo(() => {
    if (!url) return false
    return /^(https?:\/\/|git:\/\/|ssh:\/\/|git@)/.test(url)
  }, [url])

  function handleClone() {
    if (!url || !isValidUrl) return

    cloneRepo.mutate(
      {
        url,
        targetDir: customDir || undefined,
        name: customName || undefined,
        depth: shallowClone ? parseInt(shallowDepth, 10) || 1 : undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          resetState()
        },
      }
    )
  }

  function resetState() {
    setUrl("")
    setCustomDir("")
    setCustomName("")
    setShallowClone(false)
    setShallowDepth("1")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetState()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Clone Repo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Clone Repository</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Repository URL */}
          <div className="space-y-2">
            <Label htmlFor="clone-url">Repository URL</Label>
            <Input
              id="clone-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidUrl) handleClone()
              }}
              autoFocus
            />
            {url && !isValidUrl && (
              <p className="text-xs text-destructive">
                Must be a valid git URL (https://, git://, ssh://, or git@)
              </p>
            )}
          </div>

          {/* Target directory override */}
          <div className="space-y-2">
            <Label htmlFor="clone-dir" className="text-xs text-muted-foreground">
              Clone directory (optional)
            </Label>
            <Input
              id="clone-dir"
              value={customDir}
              onChange={(e) => setCustomDir(e.target.value)}
              placeholder={repoName ? `~/dev/${repoName}` : "~/dev/<repo-name>"}
              className="font-mono text-xs"
            />
          </div>

          {/* Custom display name */}
          <div className="space-y-2">
            <Label htmlFor="clone-name" className="text-xs text-muted-foreground">
              Display name (optional)
            </Label>
            <Input
              id="clone-name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={repoName || "auto-detected from URL"}
              className="text-sm"
            />
          </div>

          {/* Shallow clone toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="shallow-clone" className="text-sm">
                Shallow clone
              </Label>
              <p className="text-xs text-muted-foreground">
                Faster for large repos (limited history)
              </p>
            </div>
            <Switch
              id="shallow-clone"
              checked={shallowClone}
              onCheckedChange={setShallowClone}
            />
          </div>

          {shallowClone && (
            <div className="space-y-2">
              <Label htmlFor="shallow-depth" className="text-xs text-muted-foreground">
                Depth (number of commits)
              </Label>
              <Input
                id="shallow-depth"
                type="number"
                min="1"
                value={shallowDepth}
                onChange={(e) => setShallowDepth(e.target.value)}
                className="w-24 text-sm"
              />
            </div>
          )}

          {/* Preview */}
          {isValidUrl && repoName && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                <span>Will clone:</span>
              </div>
              {ownerRepo && (
                <div className="text-xs text-muted-foreground">
                  {ownerRepo}
                </div>
              )}
              <div className="font-mono text-xs break-all">{targetPath}</div>
              <div className="text-xs text-muted-foreground">
                as <span className="font-medium text-foreground">{displayName}</span>
              </div>
            </div>
          )}

          {/* Clone button */}
          <Button
            onClick={handleClone}
            disabled={cloneRepo.isPending || !isValidUrl}
            className="w-full"
          >
            {cloneRepo.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cloning...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Clone Repository
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
