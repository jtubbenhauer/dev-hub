"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Loader2, RotateCcw, Pencil, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  useLeaderKeyBindings,
  useLeaderWhichKeySetting,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings"
import { BUILTIN_ACTIONS, DEFAULT_LEADER_BINDINGS } from "@/lib/leader-key-defaults"
import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key"

const PAGE_LABELS: Record<string, string> = {
  global: "Global",
  chat: "Chat",
  git: "Git",
}

const PAGE_ORDER = ["global", "chat", "git"]

export function KeybindingsSettings() {
  const { bindings, isLoading: isLoadingBindings } = useLeaderKeyBindings()
  const { isWhichKeyEnabled, isLoading: isLoadingWhichKey } = useLeaderWhichKeySetting()
  const mutation = useSettingsMutation()

  const [localBindings, setLocalBindings] = useState<LeaderBindingsMap>({})
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  const [capturedKeys, setCapturedKeys] = useState<string>("")
  const [conflictActionId, setConflictActionId] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoadingBindings) setLocalBindings({ ...bindings })
  }, [bindings, isLoadingBindings])

  const isLoading = isLoadingBindings || isLoadingWhichKey

  const handleWhichKeyToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_WHICH_KEY, value: checked },
      { onSuccess: () => toast.success(checked ? "Which-key popup enabled" : "Which-key popup disabled") }
    )
  }

  const startEditing = (actionId: string) => {
    setEditingActionId(actionId)
    setCapturedKeys("")
    setConflictActionId(null)
  }

  const cancelEditing = () => {
    setEditingActionId(null)
    setCapturedKeys("")
    setConflictActionId(null)
  }

  const findConflict = (actionId: string, keys: string): string | null => {
    if (!keys) return null
    for (const [otherActionId, otherKeys] of Object.entries(localBindings)) {
      if (otherActionId === actionId) continue
      if (otherKeys === keys) return otherActionId
    }
    return null
  }

  const saveBinding = (actionId: string, keys: string) => {
    const conflict = findConflict(actionId, keys)
    if (conflict) {
      setConflictActionId(conflict)
      return
    }

    const next: LeaderBindingsMap = { ...localBindings, [actionId]: keys }
    setLocalBindings(next)
    setEditingActionId(null)
    setCapturedKeys("")
    setConflictActionId(null)

    // Persist only the overrides (keys that differ from defaults)
    const overrides: LeaderBindingsMap = {}
    for (const [id, binding] of Object.entries(next)) {
      if (binding !== DEFAULT_LEADER_BINDINGS[id]) {
        overrides[id] = binding
      }
    }
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: overrides },
      { onSuccess: () => toast.success("Keybinding saved") }
    )
  }

  const resetBinding = (actionId: string) => {
    const defaultKeys = DEFAULT_LEADER_BINDINGS[actionId]
    if (!defaultKeys) return

    const next: LeaderBindingsMap = { ...localBindings, [actionId]: defaultKeys }
    setLocalBindings(next)

    const overrides: LeaderBindingsMap = {}
    for (const [id, binding] of Object.entries(next)) {
      if (binding !== DEFAULT_LEADER_BINDINGS[id]) {
        overrides[id] = binding
      }
    }
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: overrides },
      { onSuccess: () => toast.success("Keybinding reset to default") }
    )
  }

  const resetAllBindings = () => {
    setLocalBindings({ ...DEFAULT_LEADER_BINDINGS })
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: {} },
      { onSuccess: () => toast.success("All keybindings reset to defaults") }
    )
  }

  const groupedActions = PAGE_ORDER.reduce<Record<string, LeaderAction[]>>((acc, page) => {
    acc[page] = BUILTIN_ACTIONS.filter((a) => a.page === page)
    return acc
  }, {})

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Which-key Popup</CardTitle>
          <CardDescription>
            Show a popup after pressing the leader key (Ctrl+Space) that lists available bindings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="which-key-toggle">Enable which-key popup</Label>
            <Switch
              id="which-key-toggle"
              checked={isWhichKeyEnabled}
              onCheckedChange={handleWhichKeyToggle}
              disabled={mutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>Leader Key Bindings</CardTitle>
              <CardDescription>
                Customize the key sequences triggered after Ctrl+Space. Click a row to edit.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 text-muted-foreground"
              onClick={resetAllBindings}
              disabled={mutation.isPending}
            >
              <RotateCcw className="size-3.5" />
              Reset all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {PAGE_ORDER.map((page, pageIndex) => (
            <div key={page}>
              {pageIndex > 0 && <Separator className="mb-6" />}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  {PAGE_LABELS[page] ?? page}
                </p>
                {groupedActions[page]?.map((action) => (
                  <BindingRow
                    key={action.id}
                    action={action}
                    keys={localBindings[action.id] ?? ""}
                    defaultKeys={DEFAULT_LEADER_BINDINGS[action.id] ?? ""}
                    isEditing={editingActionId === action.id}
                    capturedKeys={capturedKeys}
                    conflictActionId={conflictActionId}
                    onStartEdit={() => startEditing(action.id)}
                    onCancelEdit={cancelEditing}
                    onSave={(keys) => saveBinding(action.id, keys)}
                    onReset={() => resetBinding(action.id)}
                    onKeyCapture={setCapturedKeys}
                    onConflictClear={() => setConflictActionId(null)}
                    isSaving={mutation.isPending}
                  />
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

interface BindingRowProps {
  action: LeaderAction
  keys: string
  defaultKeys: string
  isEditing: boolean
  capturedKeys: string
  conflictActionId: string | null
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: (keys: string) => void
  onReset: () => void
  onKeyCapture: (keys: string) => void
  onConflictClear: () => void
  isSaving: boolean
}

function BindingRow({
  action,
  keys,
  defaultKeys,
  isEditing,
  capturedKeys,
  conflictActionId,
  onStartEdit,
  onCancelEdit,
  onSave,
  onReset,
  onKeyCapture,
  onConflictClear,
  isSaving,
}: BindingRowProps) {
  const captureRef = useRef<HTMLDivElement>(null)
  const isModified = keys !== defaultKeys

  useEffect(() => {
    if (isEditing) {
      captureRef.current?.focus()
    }
  }, [isEditing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Ignore pure modifier keypresses
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push("ctrl")
      if (e.altKey) parts.push("alt")
      if (e.shiftKey && e.key.length > 1) parts.push("shift")

      const key = e.key === " " ? "space" : e.key
      parts.push(key)

      const chord = parts.join("+")
      const existing = capturedKeys ? `${capturedKeys} ${chord}` : chord
      onKeyCapture(existing)
      onConflictClear()
    },
    [capturedKeys, onKeyCapture, onConflictClear]
  )

  const conflictLabel = conflictActionId
    ? (BUILTIN_ACTIONS.find((a) => a.id === conflictActionId)?.label ?? conflictActionId)
    : null

  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <span className="flex-1 text-sm">{action.label}</span>

      {isEditing ? (
        <div className="flex items-center gap-2">
          <div
            ref={captureRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="flex min-w-24 cursor-text items-center gap-1 rounded border border-ring bg-background px-2 py-1 text-xs focus:outline-none"
          >
            {capturedKeys ? (
              capturedKeys.split(" ").map((chord, i) => (
                <KeyChip key={i} chord={chord} />
              ))
            ) : (
              <span className="text-muted-foreground italic">press keys…</span>
            )}
          </div>

          {conflictLabel && (
            <span className="text-xs text-destructive">conflicts with &quot;{conflictLabel}&quot;</span>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => onSave(capturedKeys)}
            disabled={!capturedKeys || isSaving}
            title="Confirm"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={onCancelEdit}
            title="Cancel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {keys ? (
              keys.split(" ").map((chord, i) => (
                <KeyChip key={i} chord={chord} />
              ))
            ) : (
              <span className="text-xs text-muted-foreground italic">unbound</span>
            )}
          </div>

          <Button
            size="icon"
            variant="ghost"
            className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={onStartEdit}
            title="Edit binding"
          >
            <Pencil className="size-3" />
          </Button>

          {isModified && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
              onClick={onReset}
              disabled={isSaving}
              title="Reset to default"
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function KeyChip({ chord }: { chord: string }) {
  return (
    <Badge variant="outline" className="font-mono text-xs px-1.5 py-0">
      {chord}
    </Badge>
  )
}
