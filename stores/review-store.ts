import { create } from "zustand"
import { persist } from "zustand/middleware"

interface ReviewState {
  activeReviewId: string | null
  selectedFileId: number | null
  selectedFilePath: string | null

  setActiveReviewId: (id: string | null) => void
  selectFile: (fileId: number | null, filePath: string | null) => void
  clearReview: () => void
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set) => ({
      activeReviewId: null,
      selectedFileId: null,
      selectedFilePath: null,

      setActiveReviewId: (id) =>
        set({ activeReviewId: id, selectedFileId: null, selectedFilePath: null }),

      selectFile: (fileId, filePath) =>
        set({ selectedFileId: fileId, selectedFilePath: filePath }),

      clearReview: () =>
        set({ activeReviewId: null, selectedFileId: null, selectedFilePath: null }),
    }),
    {
      name: "dev-hub-review",
      partialize: (state) => ({
        activeReviewId: state.activeReviewId,
      }),
    }
  )
)
