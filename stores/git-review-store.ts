import { create } from "zustand"
import { persist } from "zustand/middleware"

interface GitReviewState {
  // Persisted as Record<compositeKey, filePath[]> because Set is not JSON-serialisable.
  // compositeKey format: `${workspaceId}:${viewMode}:${compareBaseRef ?? ""}`
  reviewedFiles: Record<string, string[]>

  getReviewedFiles: (key: string) => Set<string>
  toggleReviewed: (key: string, path: string) => void
  clearReviewed: (key: string) => void
  clearAll: () => void
}

export const useGitReviewStore = create<GitReviewState>()(
  persist(
    (set, get) => ({
      reviewedFiles: {},

      getReviewedFiles: (key) => {
        const paths = get().reviewedFiles[key]
        return paths ? new Set(paths) : new Set<string>()
      },

      toggleReviewed: (key, path) =>
        set((state) => {
          const current = state.reviewedFiles[key] ?? []
          const idx = current.indexOf(path)
          const next =
            idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, path]
          return { reviewedFiles: { ...state.reviewedFiles, [key]: next } }
        }),

      clearReviewed: (key) =>
        set((state) => {
          const { [key]: _, ...rest } = state.reviewedFiles
          return { reviewedFiles: rest }
        }),

      clearAll: () => set({ reviewedFiles: {} }),
    }),
    {
      name: "dev-hub-git-review",
      partialize: (state) => ({ reviewedFiles: state.reviewedFiles }),
    }
  )
)
