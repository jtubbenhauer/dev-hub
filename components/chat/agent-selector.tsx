"use client"

import { useState, useEffect, useCallback } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import type { Agent } from "@/lib/opencode/types"

interface UseAgentsResult {
  agents: Agent[]
  primaryAgents: Agent[]
  isLoading: boolean
}

export function useAgents(workspaceId: string | null): UseAgentsResult {
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
      setAgents(Object.values(data))
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const primaryAgents = agents.filter(
    (a) => a.mode === "primary" || a.mode === "all"
  )

  return { agents, primaryAgents, isLoading }
}

interface AgentSelectorProps {
  agents: Agent[]
  selectedAgent: string | null
  onAgentChange: (agent: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AgentSelector({
  agents,
  selectedAgent,
  onAgentChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AgentSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const activeAgent = agents.find((a) => a.name === selectedAgent)

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = controlledOnOpenChange !== undefined
    ? controlledOnOpenChange
    : setInternalOpen

  if (agents.length === 0) return null

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          className="max-w-[120px] gap-1.5 text-xs sm:max-w-[160px]"
        >
          <span className="flex items-center gap-1.5 truncate">
            {activeAgent?.color && (
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: activeAgent.color }}
              />
            )}
            <span className="truncate capitalize">
              {activeAgent?.name ?? "Agent"}
            </span>
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search agents..." />
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            {agents.map((agent) => {
              const isSelected = agent.name === selectedAgent
              return (
                <CommandItem
                  key={agent.name}
                  value={agent.name}
                  onSelect={() => {
                    onAgentChange(agent.name)
                    setIsOpen(false)
                  }}
                >
                  <Check className={cn("size-3", isSelected ? "opacity-100" : "opacity-0")} />
                  {agent.color && (
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                  )}
                  <span className="truncate capitalize">{agent.name}</span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
