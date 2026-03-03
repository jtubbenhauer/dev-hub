"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useClickUpSettings, useSettingsMutation, SETTINGS_KEYS } from "@/hooks/use-settings"
import type { ClickUpTeam, ClickUpUser } from "@/types"

export function IntegrationSettings() {
  return (
    <div className="space-y-6">
      <ClickUpSettingsCard />
    </div>
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
