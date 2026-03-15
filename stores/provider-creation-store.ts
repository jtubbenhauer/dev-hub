import { create } from "zustand"
import type { LinkedTaskMeta } from "@/types"

export type ProviderCreationPhase = "idle" | "running" | "done" | "error"

export interface OutputLine {
  stream: "stdout" | "stderr"
  data: string
}

interface ProviderCreationState {
  phase: ProviderCreationPhase
  providerName: string
  outputLines: OutputLine[]
  statusMessage: string
  errorMessage: string
  dialogOpen: boolean
  abortController: AbortController | null

  /** Start a provider workspace creation with SSE streaming. */
  startCreation: (params: {
    providerId: string
    providerName: string
    repo: string
    branch?: string
    name?: string
    context?: string
    color?: string
    linkedTaskId?: string
    linkedTaskMeta?: LinkedTaskMeta
    onSuccess: (workspaceName: string) => void
  }) => void

  /** Minimize — close dialog but keep running. */
  minimize: () => void

  /** Expand — reopen dialog to show current state. */
  expand: () => void

  /** Dismiss — reset to idle (only when done/error). */
  dismiss: () => void

  /** Abort a running creation. */
  abort: () => void

  /** Reset everything back to idle. */
  reset: () => void
}

export const useProviderCreationStore = create<ProviderCreationState>()(
  (set, get) => ({
    phase: "idle",
    providerName: "",
    outputLines: [],
    statusMessage: "",
    errorMessage: "",
    dialogOpen: false,
    abortController: null,

    startCreation: ({
      providerId,
      providerName,
      repo,
      branch,
      name,
      context,
      color,
      linkedTaskId,
      linkedTaskMeta,
      onSuccess,
    }) => {
      // Abort any previous run
      get().abortController?.abort()

      const controller = new AbortController()

      set({
        phase: "running",
        providerName,
        outputLines: [],
        statusMessage: "Starting...",
        errorMessage: "",
        dialogOpen: true,
        abortController: controller,
      })

      streamCreation({
        providerId,
        repo,
        branch,
        name,
        context,
        color,
        linkedTaskId,
        linkedTaskMeta,
        controller,
        onSuccess,
        set,
        get,
      })
    },

    minimize: () => set({ dialogOpen: false }),

    expand: () => set({ dialogOpen: true }),

    dismiss: () => {
      const { phase } = get()
      if (phase === "done" || phase === "error" || phase === "idle") {
        set({
          phase: "idle",
          providerName: "",
          outputLines: [],
          statusMessage: "",
          errorMessage: "",
          dialogOpen: false,
          abortController: null,
        })
      }
    },

    abort: () => {
      const { abortController } = get()
      abortController?.abort()
      set({
        phase: "idle",
        providerName: "",
        outputLines: [],
        statusMessage: "",
        errorMessage: "",
        dialogOpen: false,
        abortController: null,
      })
    },

    reset: () => {
      get().abortController?.abort()
      set({
        phase: "idle",
        providerName: "",
        outputLines: [],
        statusMessage: "",
        errorMessage: "",
        dialogOpen: false,
        abortController: null,
      })
    },
  })
)

async function streamCreation({
  providerId,
  repo,
  branch,
  name,
  context,
  color,
  linkedTaskId,
  linkedTaskMeta,
  controller,
  onSuccess,
  set,
  get,
}: {
  providerId: string
  repo: string
  branch?: string
  name?: string
  context?: string
  color?: string
  linkedTaskId?: string
  linkedTaskMeta?: LinkedTaskMeta
  controller: AbortController
  onSuccess: (workspaceName: string) => void
  set: (
    updater:
      | Partial<ProviderCreationState>
      | ((state: ProviderCreationState) => Partial<ProviderCreationState>)
  ) => void
  get: () => ProviderCreationState
}) {
  let completed = false

  try {
    const res = await fetch("/api/providers/create-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId,
        repo: repo.trim(),
        branch: branch?.trim() || undefined,
        name: name?.trim() || undefined,
        context: context?.trim() || undefined,
        color: color || undefined,
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskMeta: linkedTaskMeta || undefined,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = (await res.json()) as { error?: string }
      throw new Error(err.error || "Failed to create workspace")
    }

    if (!res.body) {
      throw new Error("No response stream")
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split("\n\n")
      buffer = messages.pop() || ""

      for (const msg of messages) {
        const eventMatch = msg.match(/^event: (\w+)/)
        const dataMatch = msg.match(/^data: (.+)$/m)
        if (!eventMatch || !dataMatch) continue

        const event = eventMatch[1]
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(dataMatch[1])
        } catch {
          continue
        }

        switch (event) {
          case "status":
            set({ statusMessage: payload.message as string })
            break
          case "output":
            set((state) => ({
              outputLines: [...state.outputLines, {
                stream: (payload.stream as "stdout" | "stderr") || "stdout",
                data: payload.data as string,
              }],
            }))
            break
          case "error":
            throw new Error(payload.message as string)
          case "result": {
            completed = true
            const workspace = payload.workspace as { name: string }
            set({
              phase: "done",
              statusMessage: `Workspace "${workspace.name}" created successfully`,
              abortController: null,
            })
            onSuccess(workspace.name)
            return
          }
        }
      }
    }

    if (!completed) {
      throw new Error("Stream ended without a result")
    }
  } catch (err) {
    // If we aborted, the store was already reset by abort() — don't overwrite
    if (controller.signal.aborted) return
    // Guard against store being reset while we were streaming
    if (get().abortController !== controller) return

    const message =
      err instanceof Error ? err.message : "Failed to create workspace"
    set({
      phase: "error",
      errorMessage: message,
      abortController: null,
    })
  }
}
