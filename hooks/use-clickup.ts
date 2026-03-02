"use client"

import { useQuery } from "@tanstack/react-query"
import type { ClickUpTask, ClickUpTeam, ClickUpUser } from "@/types"

interface MyTasksResponse {
  tasks: ClickUpTask[]
}

interface TeamsResponse {
  teams: ClickUpTeam[]
}

interface UserResponse {
  user: ClickUpUser
}

async function fetchMyTasks(): Promise<ClickUpTask[]> {
  const res = await fetch("/api/clickup/my-tasks")
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}))
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "Failed to fetch tasks"
    throw new Error(message)
  }
  const data = (await res.json()) as MyTasksResponse
  return data.tasks
}

async function fetchClickUpUser(): Promise<ClickUpUser> {
  const res = await fetch("/api/clickup/user")
  if (!res.ok) throw new Error("Failed to fetch ClickUp user")
  const data = (await res.json()) as UserResponse
  return data.user
}

async function fetchClickUpTeams(): Promise<ClickUpTeam[]> {
  const res = await fetch("/api/clickup/team")
  if (!res.ok) throw new Error("Failed to fetch ClickUp workspaces")
  const data = (await res.json()) as TeamsResponse
  return data.teams
}

export function useMyClickUpTasks(options: { enabled?: boolean } = {}) {
  return useQuery<ClickUpTask[], Error>({
    queryKey: ["clickup", "my-tasks"],
    queryFn: fetchMyTasks,
    staleTime: 60_000,
    refetchInterval: 300_000,
    enabled: options.enabled !== false,
  })
}

export function useClickUpUser(options: { enabled?: boolean } = {}) {
  return useQuery<ClickUpUser, Error>({
    queryKey: ["clickup", "user"],
    queryFn: fetchClickUpUser,
    staleTime: 300_000,
    enabled: options.enabled !== false,
  })
}

export function useClickUpTeams(options: { enabled?: boolean } = {}) {
  return useQuery<ClickUpTeam[], Error>({
    queryKey: ["clickup", "teams"],
    queryFn: fetchClickUpTeams,
    staleTime: 300_000,
    enabled: options.enabled !== false,
  })
}
