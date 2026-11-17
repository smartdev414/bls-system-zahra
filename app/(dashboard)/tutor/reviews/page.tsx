"use client"

import {
  Star, Loader2, MessageSquare, TrendingUp,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { useFetch } from "@/hooks/use-fetch"

type ReviewItem = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  student: { id: string; name: string; avatarUrl: string | null }
}

type ReviewsData = {
  reviews: ReviewItem[]
  stats: {
    totalReviews: number
    avgRating: number | null
    distribution: number[] // [1★, 2★, 3★, 4★, 5★]
  }
}

export default function TutorReviewsPage() {
  const { data, loading } = useFetch<ReviewsData>("/api/tutor/reviews", {
    errorMessage: "Could not load reviews",
  })

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const reviews = data?.reviews ?? []
  const stats = data?.stats

  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">Student Reviews</h1>
        <p className="text-sm text-muted-foreground mt-1">See what your students are saying about you.</p>
      </div>

      {/* Stats overview */}
      {stats && stats.totalReviews > 0 && (
        <div className="rounded-xl bg-card border p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {/* Big rating */}
            <div className="flex flex-col items-center gap-1 sm:pr-6 sm:border-r shrink-0">
              <p className="text-5xl font-black">{stats.avgRating}</p>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`size-4 ${n <= Math.round(stats.avgRating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"}`}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{stats.totalReviews} review{stats.totalReviews !== 1 ? "s" : ""}</p>
            </div>

            {/* Distribution bars */}
            <div className="flex-1 w-full flex flex-col gap-1.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = stats.distribution[star - 1]
                const pct = stats.totalReviews > 0 ? (count / stats.totalReviews) * 100 : 0
                return (
                  <div key={star} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4 text-right">{star}</span>
                    <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />
                    <Progress value={pct} className="h-2 flex-1 [&>div]:bg-amber-400" />
                    <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length > 0 ? (
        <div className="flex flex-col gap-3">
          {reviews.map((review) => {
            const initials = review.student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
            return (
              <div key={review.id} className="rounded-xl bg-card border p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="size-9 shrink-0">
                    {review.student.avatarUrl && <AvatarImage src={review.student.avatarUrl} alt={review.student.name} />}
                    <AvatarFallback className="text-[0.625rem] bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{review.student.name}</p>
                      <p className="text-[0.6875rem] text-muted-foreground shrink-0">
                        {new Date(review.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`size-3.5 ${n <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"}`} />
                      ))}
                    </div>
                    {review.comment && (
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{review.comment}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-5 mb-4">
            <MessageSquare className="size-8 text-muted-foreground" />
          </div>
          <p className="font-semibold">No reviews yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            When students rate you, their reviews will appear here.
          </p>
        </div>
      )}
    </div>
  )
}
