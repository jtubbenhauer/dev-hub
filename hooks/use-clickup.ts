"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSettings, useSettingsMutation, SETTINGS_KEYS } from "@/hooks/use-settings"
import type {
  ClickUpTask,
  ClickUpTeam,
  ClickUpUser,
  ClickUpSpace,
  ClickUpView,
  ClickUpTaskDetail,
  ClickUpComment,
  ClickUpPinnedView,
} from "@/types"

interface MyTasksResponse {
  tasks: ClickUpTask[]
}

interface TeamsResponse {
  teams: ClickUpTeam[]
}

interface UserResponse {
  user: ClickUpUser
}

interface SearchResponse {
  tasks: ClickUpTask[]
}

interface HierarchyResponse {
  spaces: ClickUpSpace[]
  views: ClickUpView[]
}

interface ViewTasksResponse {
  tasks: ClickUpTask[]
}

interface TaskDetailResponse {
  task: ClickUpTaskDetail
}

interface CommentsResponse {
  comments: ClickUpComment[]
}

interface SearchFilters {
  listIds?: string[]
  spaceIds?: string[]
  statuses?: string[]
  assignees?: string[]
  tags?: string[]
  orderBy?: string
  includeClosed?: boolean
  page?: number
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

async function fetchSearchTasks(query: string, filters: SearchFilters): Promise<ClickUpTask[]> {
  const params = new URLSearchParams()
  if (query) params.set("query", query)
  if (filters.page != null) params.set("page", String(filters.page))
  if (filters.includeClosed != null) params.set("include_closed", String(filters.includeClosed))
  if (filters.orderBy) params.set("order_by", filters.orderBy)
  for (const id of filters.listIds ?? []) params.append("list_ids[]", id)
  for (const id of filters.spaceIds ?? []) params.append("space_ids[]", id)
  for (const s of filters.statuses ?? []) params.append("statuses[]", s)
  for (const a of filters.assignees ?? []) params.append("assignees[]", a)
  for (const t of filters.tags ?? []) params.append("tags[]", t)

  const res = await fetch(`/api/clickup/search?${params.toString()}`)
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}))
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "Failed to search tasks"
    throw new Error(message)
  }
  const data = (await res.json()) as SearchResponse
  return data.tasks
}

async function fetchHierarchy(): Promise<HierarchyResponse> {
  const res = await fetch("/api/clickup/hierarchy")
  if (!res.ok) throw new Error("Failed to fetch workspace hierarchy")
  return res.json() as Promise<HierarchyResponse>
}

async function fetchViewTasks(viewId: string, page: number): Promise<ClickUpTask[]> {
  const res = await fetch(`/api/clickup/views/${viewId}/tasks?page=${page}`)
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}))
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "Failed to fetch view tasks"
    throw new Error(message)
  }
  const data = (await res.json()) as ViewTasksResponse
  return data.tasks
}

async function fetchTaskDetail(taskId: string): Promise<ClickUpTaskDetail> {
  const res = await fetch(`/api/clickup/tasks/${taskId}`)
  if (!res.ok) throw new Error("Failed to fetch task detail")
  const data = (await res.json()) as TaskDetailResponse
  return data.task
}

async function fetchTaskComments(taskId: string): Promise<ClickUpComment[]> {
  const res = await fetch(`/api/clickup/tasks/${taskId}/comments`)
  if (!res.ok) throw new Error("Failed to fetch task comments")
  const data = (await res.json()) as CommentsResponse
  return data.comments
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

export function useClickUpSearch(
  query: string,
  filters: SearchFilters = {},
  options: { enabled?: boolean } = {}
) {
  const hasFilters = Object.values(filters).some((v) =>
    Array.isArray(v) ? v.length > 0 : v != null
  )
  return useQuery<ClickUpTask[], Error>({
    queryKey: ["clickup", "search", query, filters],
    queryFn: () => fetchSearchTasks(query, filters),
    staleTime: 30_000,
    enabled: options.enabled !== false && (query.length >= 2 || hasFilters),
  })
}

export function useClickUpHierarchy(options: { enabled?: boolean } = {}) {
  return useQuery<HierarchyResponse, Error>({
    queryKey: ["clickup", "hierarchy"],
    queryFn: fetchHierarchy,
    staleTime: 300_000,
    enabled: options.enabled !== false,
  })
}

export function useClickUpViewTasks(
  viewId: string | null,
  page = 0,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ClickUpTask[], Error>({
    queryKey: ["clickup", "view-tasks", viewId, page],
    queryFn: () => fetchViewTasks(viewId!, page),
    staleTime: 60_000,
    enabled: options.enabled !== false && viewId != null,
  })
}

export function useClickUpTaskDetail(
  taskId: string | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ClickUpTaskDetail, Error>({
    queryKey: ["clickup", "task-detail", taskId],
    queryFn: () => fetchTaskDetail(taskId!),
    staleTime: 60_000,
    enabled: options.enabled !== false && taskId != null,
  })
}

export function useClickUpTaskComments(
  taskId: string | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ClickUpComment[], Error>({
    queryKey: ["clickup", "task-comments", taskId],
    queryFn: () => fetchTaskComments(taskId!),
    staleTime: 60_000,
    enabled: options.enabled !== false && taskId != null,
  })
}

export function useClickUpPinnedViews(): {
  pinnedViews: ClickUpPinnedView[]
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.CLICKUP_PINNED_VIEWS]
  const pinnedViews = Array.isArray(raw) ? (raw as ClickUpPinnedView[]) : []
  return { pinnedViews, isLoading }
}

export function usePinView() {
  const queryClient = useQueryClient()
  const { mutate: saveSetting } = useSettingsMutation()
  const { pinnedViews } = useClickUpPinnedViews()

  return useMutation({
    mutationFn: async (view: ClickUpPinnedView) => {
      const alreadyPinned = pinnedViews.some((v) => v.id === view.id)
      if (alreadyPinned) return
      saveSetting({ key: SETTINGS_KEYS.CLICKUP_PINNED_VIEWS, value: [...pinnedViews, view] })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
  })
}

export function useUnpinView() {
  const queryClient = useQueryClient()
  const { mutate: saveSetting } = useSettingsMutation()
  const { pinnedViews } = useClickUpPinnedViews()

  return useMutation({
    mutationFn: async (viewId: string) => {
      saveSetting({
        key: SETTINGS_KEYS.CLICKUP_PINNED_VIEWS,
        value: pinnedViews.filter((v) => v.id !== viewId),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
  })
}
