"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useEditorStore } from "@/stores/editor-store"
import { useAgents } from "@/components/chat/agent-selector"
import {
  useModelAllowlist,
  useModelAgentBindings,
  useVimModeSetting,
  useFontSizeSetting,
  useTabSizeSetting,
  useShellRcPathSetting,
  useDefaultWorkspaceSetting,
  useWorktreeBaseDirSetting,
  useCloneBaseDirSetting,
  useClickUpSettings,
  useSettingsMutation,
  SETTINGS_KEYS,
  FONT_SIZE_OPTIONS,
  TAB_SIZE_OPTIONS,
  DEFAULT_FONT_SIZE,
  DEFAULT_TAB_SIZE,
} from "@/hooks/use-settings"
import type { FontSize, TabSize } from "@/hooks/use-settings"
import type { Provider, Model, Agent } from "@/lib/opencode/types"
import type { ClickUpTeam, ClickUpUser } from "@/types"

interface ProviderWithModels {
  provider: Provider
  models: Model[]
}

interface ConfigProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

interface SelectedModel {
  providerID: string
  modelID: string
}

interface SystemInfo {
  os: string
  nodeVersion: string
  gitVersion: string
}

export default function SettingsPage() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)

  return (
    <AuthenticatedLayout>
        <div className="h-full overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure models, agent bindings, and preferences.
            </p>
          </div>

          <EditorSettingsCard />

          {activeWorkspaceId ? (
            <ModelSettings workspaceId={activeWorkspaceId} />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Select a workspace from the sidebar to configure model settings.
                </p>
              </CardContent>
            </Card>
          )}

          <WorkspaceSettingsCard />

          <CommandSettingsCard />

          <ClickUpSettingsCard />

          <AboutCard />
        </div>
      </div>
    </AuthenticatedLayout>
  )
}

function EditorSettingsCard() {
  const { isVimMode, isLoading: isLoadingVim } = useVimModeSetting()
  const { fontSize, isLoading: isLoadingFont } = useFontSizeSetting()
  const { tabSize, isLoading: isLoadingTab } = useTabSizeSetting()
  const setVimMode = useEditorStore((s) => s.setVimMode)
  const mutation = useSettingsMutation()

  const isLoading = isLoadingVim || isLoadingFont || isLoadingTab

  // Sync DB vim mode into editor store on load
  useEffect(() => {
    if (!isLoadingVim) {
      setVimMode(isVimMode)
    }
  }, [isVimMode, isLoadingVim, setVimMode])

  const handleVimToggle = (checked: boolean) => {
    setVimMode(checked)
    mutation.mutate(
      { key: SETTINGS_KEYS.VIM_MODE, value: checked },
      { onSuccess: () => toast.success(checked ? "Vim mode enabled" : "Vim mode disabled") }
    )
  }

  const handleFontSizeChange = (value: string) => {
    const next = Number(value) as FontSize
    mutation.mutate(
      { key: SETTINGS_KEYS.FONT_SIZE, value: next },
      { onSuccess: () => toast.success(`Font size set to ${next}px`) }
    )
  }

  const handleTabSizeChange = (value: string) => {
    const next = Number(value) as TabSize
    mutation.mutate(
      { key: SETTINGS_KEYS.TAB_SIZE, value: next },
      { onSuccess: () => toast.success(`Tab size set to ${next} spaces`) }
    )
  }

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
    <Card>
      <CardHeader>
        <CardTitle>Editor</CardTitle>
        <CardDescription>
          Configure the code editor behavior and appearance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="vim-mode">Vim mode</Label>
            <p className="text-xs text-muted-foreground">
              Enable Vim keybindings in the code editor
            </p>
          </div>
          <Switch
            id="vim-mode"
            checked={isVimMode}
            onCheckedChange={handleVimToggle}
            disabled={mutation.isPending}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="font-size">Font size</Label>
            <p className="text-xs text-muted-foreground">
              Editor font size in pixels
            </p>
          </div>
          <Select
            value={String(fontSize)}
            onValueChange={handleFontSizeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="font-size" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px{size === DEFAULT_FONT_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="tab-size">Tab size</Label>
            <p className="text-xs text-muted-foreground">
              Number of spaces per tab
            </p>
          </div>
          <Select
            value={String(tabSize)}
            onValueChange={handleTabSizeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="tab-size" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} spaces{size === DEFAULT_TAB_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

function WorkspaceSettingsCard() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const { defaultWorkspaceId, isLoading: isLoadingDefault } = useDefaultWorkspaceSetting()
  const { worktreeBaseDir, isLoading: isLoadingWorktree } = useWorktreeBaseDirSetting()
  const { cloneBaseDir, isLoading: isLoadingClone } = useCloneBaseDirSetting()
  const mutation = useSettingsMutation()

  const [localWorktreeDir, setLocalWorktreeDir] = useState("")
  const [localCloneDir, setLocalCloneDir] = useState("")

  const isLoading = isLoadingDefault || isLoadingWorktree || isLoadingClone

  useEffect(() => {
    if (!isLoadingWorktree) setLocalWorktreeDir(worktreeBaseDir)
  }, [worktreeBaseDir, isLoadingWorktree])

  useEffect(() => {
    if (!isLoadingClone) setLocalCloneDir(cloneBaseDir)
  }, [cloneBaseDir, isLoadingClone])

  const handleDefaultWorkspaceChange = (value: string) => {
    const next = value === "__none__" ? null : value
    mutation.mutate(
      { key: SETTINGS_KEYS.DEFAULT_WORKSPACE, value: next },
      { onSuccess: () => toast.success(next ? "Default workspace set" : "Default workspace cleared") }
    )
  }

  const handleWorktreeDirSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.WORKTREE_BASE_DIR, value: localWorktreeDir },
      { onSuccess: () => toast.success("Worktree base directory updated") }
    )
  }

  const handleCloneDirSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.CLONE_BASE_DIR, value: localCloneDir },
      { onSuccess: () => toast.success("Clone base directory updated") }
    )
  }

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
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          Default workspace and directory preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-workspace">Default workspace</Label>
          <p className="text-xs text-muted-foreground">
            Automatically selected when you open the app
          </p>
          <Select
            value={defaultWorkspaceId ?? "__none__"}
            onValueChange={handleDefaultWorkspaceChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="default-workspace">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="worktree-base-dir">Worktree base directory</Label>
          <p className="text-xs text-muted-foreground">
            Base path for new worktrees. Leave empty for repo-relative default.
          </p>
          <div className="flex gap-2">
            <Input
              id="worktree-base-dir"
              value={localWorktreeDir}
              onChange={(e) => setLocalWorktreeDir(e.target.value)}
              placeholder="e.g. ~/worktrees/"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleWorktreeDirSave}
              disabled={localWorktreeDir === worktreeBaseDir || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clone-base-dir">Clone base directory</Label>
          <p className="text-xs text-muted-foreground">
            Default directory for cloning new repositories
          </p>
          <div className="flex gap-2">
            <Input
              id="clone-base-dir"
              value={localCloneDir}
              onChange={(e) => setLocalCloneDir(e.target.value)}
              placeholder="~/dev/"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCloneDirSave}
              disabled={localCloneDir === cloneBaseDir || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CommandSettingsCard() {
  const { shellRcPath, isLoading } = useShellRcPathSetting()
  const mutation = useSettingsMutation()
  const [localPath, setLocalPath] = useState("")

  useEffect(() => {
    if (!isLoading) setLocalPath(shellRcPath)
  }, [shellRcPath, isLoading])

  const handleSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SHELL_RC_PATH, value: localPath },
      { onSuccess: () => toast.success("Shell RC path updated") }
    )
  }

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
    <Card>
      <CardHeader>
        <CardTitle>Commands</CardTitle>
        <CardDescription>
          Configure command runner and shell integration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="shell-rc-path">Shell RC file path</Label>
          <p className="text-xs text-muted-foreground">
            Path to your shell config file for alias parsing in command autocomplete
          </p>
          <div className="flex gap-2">
            <Input
              id="shell-rc-path"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="~/.zshrc"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={localPath === shellRcPath || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ClickUpSettingsCard() {
  const { apiToken, teamId, isLoading: isLoadingSettings } = useClickUpSettings()
  const mutation = useSettingsMutation()

  const [localToken, setLocalToken] = useState("")
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [teams, setTeams] = useState<ClickUpTeam[]>([])
  const [connectedUser, setConnectedUser] = useState<ClickUpUser | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoadingSettings) {
      setLocalToken(apiToken ?? "")
      setSelectedTeamId(teamId ?? "")
    }
  }, [apiToken, teamId, isLoadingSettings])

  const handleConnect = useCallback(async () => {
    const trimmedToken = localToken.trim()
    if (!trimmedToken) {
      setConnectionError("Please enter an API token")
      return
    }

    setIsConnecting(true)
    setConnectionError(null)
    setConnectedUser(null)
    setTeams([])

    try {
      // Save token first so the proxy can use it
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SETTINGS_KEYS.CLICKUP_API_TOKEN, value: trimmedToken }),
      })

      const [userRes, teamsRes] = await Promise.all([
        fetch("/api/clickup/user"),
        fetch("/api/clickup/team"),
      ])

      if (!userRes.ok || !teamsRes.ok) {
        setConnectionError("Invalid API token or connection failed")
        return
      }

      const userData = (await userRes.json()) as { user: ClickUpUser }
      const teamsData = (await teamsRes.json()) as { teams: ClickUpTeam[] }

      setConnectedUser(userData.user)
      setTeams(teamsData.teams)

      // Auto-select if there's only one workspace
      if (teamsData.teams.length === 1 && teamsData.teams[0]) {
        setSelectedTeamId(teamsData.teams[0].id)
      }

      toast.success(`Connected as ${userData.user.username}`)
    } catch {
      setConnectionError("Failed to connect to ClickUp")
    } finally {
      setIsConnecting(false)
    }
  }, [localToken])

  const handleSave = useCallback(() => {
    if (!selectedTeamId) {
      toast.error("Please select a workspace")
      return
    }
    mutation.mutate(
      { key: SETTINGS_KEYS.CLICKUP_TEAM_ID, value: selectedTeamId },
      {
        onSuccess: () => {
          if (connectedUser) {
            mutation.mutate(
              { key: SETTINGS_KEYS.CLICKUP_USER_ID, value: String(connectedUser.id) },
              { onSuccess: () => toast.success("ClickUp settings saved") }
            )
          } else {
            toast.success("ClickUp settings saved")
          }
        },
      }
    )
  }, [selectedTeamId, connectedUser, mutation])

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const isAlreadyConfigured = !!(apiToken && teamId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>ClickUp</CardTitle>
        <CardDescription>
          Connect your ClickUp account to see tasks on the dashboard.{" "}
          <a
            href="https://app.clickup.com/settings/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Get your API token
            <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyConfigured && !connectedUser && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            ClickUp is connected
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="clickup-token">Personal API token</Label>
          <div className="flex gap-2">
            <Input
              id="clickup-token"
              type="password"
              value={localToken}
              onChange={(e) => {
                setLocalToken(e.target.value)
                setConnectionError(null)
              }}
              placeholder="pk_••••••••"
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleConnect}
              disabled={isConnecting || !localToken.trim()}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
          {connectionError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="size-3" />
              {connectionError}
            </p>
          )}
          {connectedUser && (
            <p className="flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle2 className="size-3" />
              Connected as {connectedUser.username} ({connectedUser.email})
            </p>
          )}
        </div>

        {teams.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="clickup-workspace">Workspace</Label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger id="clickup-workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(connectedUser || isAlreadyConfigured) && teams.length > 0 && (
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!selectedTeamId || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AboutCard() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    fetch("/api/settings/about")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SystemInfo | null) => {
        if (data) setSystemInfo(data)
      })
      .catch(() => {})
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>
          Application and system information.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">App version</span>
          <span className="font-mono">0.1.0</span>
        </div>
        {systemInfo && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">OS</span>
              <span className="font-mono">{systemInfo.os}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Node.js</span>
              <span className="font-mono">{systemInfo.nodeVersion}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Git</span>
              <span className="font-mono">{systemInfo.gitVersion}</span>
            </div>
          </>
        )}
        <div className="pt-2">
          <a
            href="https://github.com/jackharrhy/dev-hub"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="size-3.5" />
            View on GitHub
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

function ModelSettings({ workspaceId }: { workspaceId: string }) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const { allowlist, isLoading: isLoadingAllowlist } = useModelAllowlist()
  const { bindings, isLoading: isLoadingBindings } = useModelAgentBindings()
  const { primaryAgents, isLoading: isLoadingAgents } = useAgents(workspaceId)
  const mutation = useSettingsMutation()

  const fetchProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    try {
      const params = new URLSearchParams({ workspaceId })
      const response = await fetch(`/api/opencode/config/providers?${params.toString()}`)
      if (!response.ok) return

      const data: ConfigProvidersResponse = await response.json()
      setProviders(
        data.providers.map((provider) => ({
          provider,
          models: Object.values(provider.models),
        }))
      )
    } catch {
      toast.error("Failed to load providers")
    } finally {
      setIsLoadingProviders(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const isLoading = isLoadingProviders || isLoadingAllowlist || isLoadingBindings || isLoadingAgents

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
    <>
      <AllowlistCard
        providers={providers}
        allowlist={allowlist}
        onSave={(next) =>
          mutation.mutate(
            { key: SETTINGS_KEYS.MODEL_ALLOWLIST, value: next },
            { onSuccess: () => toast.success("Model allowlist updated") }
          )
        }
        isSaving={mutation.isPending}
      />

      <AgentBindingsCard
        agents={primaryAgents}
        providers={providers}
        bindings={bindings}
        onSave={(next) =>
          mutation.mutate(
            { key: SETTINGS_KEYS.MODEL_AGENT_BINDINGS, value: next },
            { onSuccess: () => toast.success("Agent bindings updated") }
          )
        }
        isSaving={mutation.isPending}
      />
    </>
  )
}

function AllowlistCard({
  providers,
  allowlist,
  onSave,
  isSaving,
}: {
  providers: ProviderWithModels[]
  allowlist: string[]
  onSave: (allowlist: string[]) => void
  isSaving: boolean
}) {
  const [local, setLocal] = useState<Set<string>>(() => new Set(allowlist))

  // Sync when server data arrives after initial render
  useEffect(() => {
    setLocal(new Set(allowlist))
  }, [allowlist])

  const isDirty = (() => {
    if (local.size !== allowlist.length) return true
    return allowlist.some((key) => !local.has(key))
  })()

  const toggleModel = (key: string) => {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSave = () => {
    onSave(Array.from(local))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Allowlist</CardTitle>
        <CardDescription>
          Select which models appear in the model selector. Leave all unchecked to show everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {providers.map((p) => (
          <div key={p.provider.id} className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {p.provider.name || p.provider.id}
            </p>
            <div className="space-y-1.5 pl-1">
              {p.models.map((m) => {
                const key = `${p.provider.id}::${m.id}`
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`allowlist-${key}`}
                      checked={local.has(key)}
                      onCheckedChange={() => toggleModel(key)}
                    />
                    <Label
                      htmlFor={`allowlist-${key}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {m.name || m.id}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {providers.length === 0 && (
          <p className="text-sm text-muted-foreground">No providers available.</p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save allowlist"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AgentBindingsCard({
  agents,
  providers,
  bindings,
  onSave,
  isSaving,
}: {
  agents: Agent[]
  providers: ProviderWithModels[]
  bindings: Record<string, SelectedModel>
  onSave: (bindings: Record<string, SelectedModel>) => void
  isSaving: boolean
}) {
  const [local, setLocal] = useState<Record<string, SelectedModel>>(() => ({ ...bindings }))

  useEffect(() => {
    setLocal({ ...bindings })
  }, [bindings])

  const isDirty = JSON.stringify(local) !== JSON.stringify(bindings)

  const setBinding = (agentName: string, value: string) => {
    setLocal((prev) => {
      const next = { ...prev }
      if (value === "__none__") {
        delete next[agentName]
      } else {
        const [providerID, modelID] = value.split("::")
        if (providerID && modelID) {
          next[agentName] = { providerID, modelID }
        }
      }
      return next
    })
  }

  const handleSave = () => {
    onSave(local)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent → Model Bindings</CardTitle>
        <CardDescription>
          Automatically switch to a specific model when selecting an agent.
          Leave unset to use the last-selected model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {agents.map((agent) => {
          const bound = local[agent.name]
          const currentValue = bound
            ? `${bound.providerID}::${bound.modelID}`
            : "__none__"

          return (
            <div key={agent.name} className="flex items-center gap-4">
              <Label className="w-28 shrink-0 text-sm font-medium">
                {agent.name}
              </Label>
              <Select value={currentValue} onValueChange={(v) => setBinding(agent.name, v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="No binding (use last selected)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No binding</SelectItem>
                  {providers.map((p) => (
                    <SelectGroup key={p.provider.id}>
                      <SelectLabel>{p.provider.name || p.provider.id}</SelectLabel>
                      {p.models.map((m) => (
                        <SelectItem
                          key={`${p.provider.id}::${m.id}`}
                          value={`${p.provider.id}::${m.id}`}
                        >
                          {m.name || m.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}

        {agents.length === 0 && (
          <p className="text-sm text-muted-foreground">No agents available.</p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save bindings"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
