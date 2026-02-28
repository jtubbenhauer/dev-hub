"use client"

import { useState, useEffect, useCallback } from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Agent } from "@/lib/opencode/types"

interface AgentSelectorProps {
  workspaceId: string | null
  selectedAgent: string | null
  onAgentChange: (agent: string) => void
}

export function AgentSelector({
  workspaceId,
  selectedAgent,
  onAgentChange,
}: AgentSelectorProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchAgents = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ workspaceId })
      const response = await fetch(`/api/opencode/agent?${params.toString()}`)
      if (!response.ok) return

      const data: Record<string, Agent> = await response.json()
      const agentList = Object.values(data)
      setAgents(agentList)

      if (!selectedAgent && agentList.length > 0) {
        const defaultAgent =
          agentList.find((a) => a.name === "code") ?? agentList[0]
        onAgentChange(defaultAgent.name)
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, selectedAgent, onAgentChange])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const primaryAgents = agents.filter(
    (a) => a.mode === "primary" || a.mode === "all"
  )

  if (isLoading || primaryAgents.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-1.5 text-xs"
      >
        <Bot className="size-3" />
        {isLoading ? "Loading..." : "No agents"}
      </Button>
    )
  }

  return (
    <Select value={selectedAgent ?? undefined} onValueChange={onAgentChange}>
      <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
        <Bot className="size-3" />
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent className="max-w-72">
        {primaryAgents.map((agent) => (
          <SelectItem key={agent.name} value={agent.name}>
            <div className="flex items-center gap-2">
              {agent.color && (
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: agent.color }}
                />
              )}
              <span className="shrink-0 capitalize">{agent.name}</span>
              {agent.description && (
                <span className="truncate text-[10px] text-muted-foreground">
                  {agent.description}
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
