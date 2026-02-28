"use client"

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { useReviewStore } from "@/stores/review-store"
import { ReviewSetup } from "@/components/review/review-setup"
import { ReviewInterface } from "@/components/review/review-interface"

export default function ReviewPage() {
  const { activeReviewId } = useReviewStore()

  return (
    <AuthenticatedLayout>
      {activeReviewId ? <ReviewInterface /> : <ReviewSetup />}
    </AuthenticatedLayout>
  )
}
