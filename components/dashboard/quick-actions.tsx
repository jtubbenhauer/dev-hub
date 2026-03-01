"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  GitPullRequest,
  GitBranch,
  MessageSquare,
  FolderOpen,
  Terminal,
  Plus,
  Trash2,
  Settings,
  Zap,
} from "lucide-react"
import type { QuickAction } from "@/types"

const DEFAULT_ACTIONS: QuickAction[] = [
  {
    id: "default-chat",
    label: "Open Chat",
    icon: "MessageSquare",
    type: "navigate",
    target: "/chat",
  },
  {
    id: "default-files",
    label: "Files",
    icon: "FolderOpen",
    type: "navigate",
    target: "/files",
  },
  {
    id: "default-commands",
    label: "Run Command",
    icon: "Terminal",
    type: "navigate",
    target: "/commands",
  },
  {
    id: "default-workspaces",
    label: "Workspaces",
    icon: "GitBranch",
    type: "navigate",
    target: "/workspaces",
  },
]

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageSquare,
  FolderOpen,
  Terminal,
  GitBranch,
  GitPullRequest,
  Zap,
}

const ICON_OPTIONS = Object.keys(ICON_MAP)

async function fetchQuickActions(): Promise<QuickAction[]> {
  const res = await fetch("/api/settings")
  if (!res.ok) throw new Error("Failed to fetch settings")
  const data: Record<string, unknown> = await res.json()
  const stored = data["quickActions"]
  if (Array.isArray(stored)) return stored as QuickAction[]
  return DEFAULT_ACTIONS
}

async function saveQuickActions(actions: QuickAction[]): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "quickActions", value: actions }),
  })
  if (!res.ok) throw new Error("Failed to save quick actions")
}

function ActionIcon({ iconName, className }: { iconName: string; className?: string }) {
  const IconComponent = ICON_MAP[iconName] ?? Zap
  return <IconComponent className={className} />
}

export function QuickActions() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)

  const { data: actions = DEFAULT_ACTIONS } = useQuery({
    queryKey: ["quick-actions"],
    queryFn: fetchQuickActions,
    staleTime: 60_000,
  })

  const saveMutation = useMutation({
    mutationFn: saveQuickActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-actions"] })
      toast.success("Quick actions saved")
      setIsEditing(false)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleAction = useCallback(
    (action: QuickAction) => {
      if (action.type === "navigate") {
        router.push(action.target)
      }
    },
    [router]
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="outline"
          size="sm"
          onClick={() => handleAction(action)}
          className="h-8 gap-1.5"
        >
          <ActionIcon iconName={action.icon} className="size-3.5" />
          {action.label}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsEditing(true)}
        className="h-8 gap-1.5 text-muted-foreground"
      >
        <Settings className="size-3.5" />
        Edit
      </Button>

      <QuickActionsEditor
        open={isEditing}
        actions={actions}
        onClose={() => setIsEditing(false)}
        onSave={(updated) => saveMutation.mutate(updated)}
        isSaving={saveMutation.isPending}
      />
    </div>
  )
}

interface EditorProps {
  open: boolean
  actions: QuickAction[]
  onClose: () => void
  onSave: (actions: QuickAction[]) => void
  isSaving: boolean
}

function QuickActionsEditor({ open, actions, onClose, onSave, isSaving }: EditorProps) {
  const [draft, setDraft] = useState<QuickAction[]>([...actions])

  // Sync draft when actions prop changes (e.g. after save)
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setDraft([...actions])
      else onClose()
    },
    [actions, onClose]
  )

  const updateAction = useCallback((id: string, updates: Partial<QuickAction>) => {
    setDraft((prev) =>
      prev.map((action) => (action.id === id ? { ...action, ...updates } : action))
    )
  }, [])

  const removeAction = useCallback((id: string) => {
    setDraft((prev) => prev.filter((action) => action.id !== id))
  }, [])

  const addAction = useCallback(() => {
    const newAction: QuickAction = {
      id: `custom-${Date.now()}`,
      label: "New Action",
      icon: "Zap",
      type: "navigate",
      target: "/",
    }
    setDraft((prev) => [...prev, newAction])
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Quick Actions</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {draft.map((action) => (
            <div key={action.id} className="flex items-center gap-2">
              <Select
                value={action.icon}
                onValueChange={(value) => updateAction(action.id, { icon: value })}
              >
                <SelectTrigger className="w-20 h-8 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map((name) => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-1.5">
                        <ActionIcon iconName={name} className="size-3.5" />
                        {name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={action.label}
                onChange={(e) => updateAction(action.id, { label: e.target.value })}
                placeholder="Label"
                className="h-8 flex-1"
              />
              <Input
                value={action.target}
                onChange={(e) => updateAction(action.id, { target: e.target.value })}
                placeholder="/path"
                className="h-8 flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeAction(action.id)}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground px-0.5 space-y-0.5">
          <Label className="text-xs text-muted-foreground">
            Icon &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Label &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Path
          </Label>
        </div>
        <div className="flex justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={addAction} className="gap-1.5">
            <Plus className="size-3.5" />
            Add action
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onSave(draft)} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
