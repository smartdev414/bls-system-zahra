"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  BookOpen, Users, Star, Video, ArrowLeft, ArrowRight,
  Loader2, BadgeCheck, Calendar, CheckCircle2, Trophy,
  LogOut, MessageSquare,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFetch, usePostCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { levelColor, type CourseLevel } from "@/lib/levels"

// ─── Types ───────────────────────────────────────────────────────────────────

type TutorProfile = {
  id: string
  name: string
  avatarUrl: string | null
  bio: string | null
  qualifications: string[]
  isVerified: boolean
  joinedAt: string
  stats: {
    courseCount: number
    studentCount: number
    avgRating: number | null
    reviewCount: number
    sessionCount: number
    tutorAvgRating: number | null
    tutorReviewCount: number
  }
}

type TutorReviewItem = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  student: { id: string; name: string; avatarUrl: string | null }
}

type Course = {
  id: string
  title: string
  description: string
  thumbnailUrl: string | null
  level: CourseLevel
  category: { id: string; name: string } | null
  enrollmentCount: number
  sectionCount: number
  lessonCount: number
  avgRating: number | null
  reviewCount: number
  isEnrolled: boolean
  canLeave?: boolean
  progress: {
    completedLessons: number
    totalLessons: number
    completion: number
    isCompleted: boolean
  } | null
}

type MyReview = { id: string; rating: number; comment: string | null } | null

type PageData = { tutor: TutorProfile; courses: Course[]; reviews: TutorReviewItem[]; myReview: MyReview }

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TutorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, refetch } = useFetch<PageData>(`/api/student/tutors/${id}`, {
    errorMessage: "Could not load tutor profile",
  })

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const { tutor, courses, reviews, myReview } = data
  const initials = tutor.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  return (
    <div className="flex flex-col gap-8">
      {/* Back link */}
      <Link
        href="/student/tutors"
        className="flex items-center gap-1.5 text-sm max-sm:py-1.5 text-muted-foreground hover:text-foreground w-fit transition-colors"
      >
        <ArrowLeft className="size-3.5" /> All Tutors
      </Link>

      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-violet-600" />
        <div className="absolute -right-12 -top-12 size-56 rounded-full bg-white/5" />
        <div className="absolute -right-4 bottom-4 size-32 rounded-full bg-white/5" />
        <div className="absolute left-1/3 -top-8 size-40 rounded-full bg-white/5" />

        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            {/* Avatar */}
            <Avatar className="size-20 sm:size-24 ring-4 ring-white/20 shrink-0">
              {tutor.avatarUrl && <AvatarImage src={tutor.avatarUrl} alt={tutor.name} />}
              <AvatarFallback className="bg-white/20 text-white text-2xl font-black">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {tutor.name}
                </h1>
                {tutor.isVerified && (
                  <BadgeCheck className="size-5 text-white/80 shrink-0" />
                )}
              </div>

              {tutor.bio && (
                <p className="text-sm text-white/75 mt-2 max-w-xl leading-relaxed line-clamp-3">
                  {tutor.bio}
                </p>
              )}

              {/* Qualifications */}
              {tutor.qualifications.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tutor.qualifications.map((q) => (
                    <span
                      key={q}
                      className="text-[11px] font-medium bg-white/15 text-white/90 rounded-full px-2.5 py-0.5"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              )}

              {/* Member since */}
              <div className="flex items-center gap-1.5 text-xs text-white/50 mt-3">
                <Calendar className="size-3" />
                Teaching since {new Date(tutor.joinedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Courses", value: tutor.stats.courseCount, icon: BookOpen, color: "text-violet-600 bg-violet-50" },
          { label: "Students", value: tutor.stats.studentCount, icon: Users, color: "text-blue-600 bg-blue-50" },
          {
            label: "Rating",
            value: tutor.stats.avgRating ? `${tutor.stats.avgRating}` : "—",
            sub: tutor.stats.reviewCount > 0 ? `${tutor.stats.reviewCount} reviews` : null,
            icon: Star,
            color: "text-amber-600 bg-amber-50",
          },
          { label: "Sessions", value: tutor.stats.sessionCount, icon: Video, color: "text-emerald-600 bg-emerald-50" },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="rounded-xl bg-card px-4 py-3 flex items-center gap-3">
            <div className={`rounded-lg p-2 shrink-0 ${color}`}>
              <Icon className="size-4" />
            </div>
            <div>
              <p className="text-xl font-black leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{sub ?? label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Courses */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen className="size-4 text-primary" /> Courses
          </h2>
          {courses.length > 0 && (
            <Link
              href={`/student/courses?tutorId=${tutor.id}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          )}
        </div>

        {courses.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <ProfileCourseCard key={course.id} course={course} tutorId={tutor.id} onMutated={refetch} />
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-sm text-muted-foreground">
            This tutor hasn&apos;t published any courses yet.
          </div>
        )}
      </div>

      {/* Reviews */}
      <TutorReviewSection tutorId={tutor.id} reviews={reviews} stats={tutor.stats} isEnrolled={courses.some((c) => c.isEnrolled)} hasReviewed={!!myReview} onMutated={refetch} />
    </div>
  )
}

// ─── Tutor Review Section ────────────────────────────────────────────────────

function TutorReviewSection({
  tutorId,
  reviews,
  stats,
  isEnrolled,
  hasReviewed,
  onMutated,
}: {
  tutorId: string
  reviews: TutorReviewItem[]
  stats: TutorProfile["stats"]
  isEnrolled: boolean
  hasReviewed: boolean
  onMutated: () => void
}) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [showForm, setShowForm] = useState(false)

  const { execute: submitReview, loading: submitting } = usePostCallback<
    { review: object },
    { rating: number; comment: string }
  >(`/api/student/tutors/${tutorId}/review`, {
    successMessage: "Review submitted!",
    errorMessage: "Could not submit review",
    onSuccess: () => { setShowForm(false); setComment(""); setRating(5); onMutated() },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Star className="size-4 text-primary" /> Reviews
          {stats.tutorReviewCount > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({stats.tutorAvgRating} avg &middot; {stats.tutorReviewCount})
            </span>
          )}
        </h2>
        {!showForm && isEnrolled && !hasReviewed && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="text-xs gap-1.5">
            <Star className="size-3.5" /> Rate this tutor
          </Button>
        )}
        {hasReviewed && (
          <Badge variant="secondary" className="text-xs gap-1">
            <CheckCircle2 className="size-3" /> You reviewed this tutor
          </Badge>
        )}
      </div>

      {/* Review form */}
      {showForm && (
        <div className="rounded-xl bg-card border p-4 mb-4">
          <p className="text-sm font-semibold mb-3">Your rating</p>
          <div className="flex gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} className="cursor-pointer">
                <Star className={`size-7 transition-colors ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Share your experience with this tutor... (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="resize-none mb-3"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" disabled={submitting} onClick={() => submitReview({ rating, comment })}>
              {submitting ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              {submitting ? "Submitting..." : "Submit Review"}
            </Button>
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
                  <Avatar className="size-8 shrink-0">
                    {review.student.avatarUrl && <AvatarImage src={review.student.avatarUrl} alt={review.student.name} />}
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{review.student.name}</p>
                      <p className="text-[11px] text-muted-foreground shrink-0">
                        {new Date(review.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`size-3 ${n <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"}`} />
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
      ) : !showForm ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <MessageSquare className="size-6 mx-auto mb-2 text-muted-foreground/40" />
          No reviews yet. Be the first to rate this tutor!
        </div>
      ) : null}
    </div>
  )
}

// ─── Course card (simplified for profile) ────────────────────────────────────

function ProfileCourseCard({
  course,
  tutorId,
  onMutated,
}: {
  course: Course
  tutorId: string
  onMutated: () => void
}) {
  const isCompleted = course.progress?.isCompleted ?? false
  const completion = course.progress?.completion ?? 0

  const { execute: enroll, loading: enrolling } = usePostCallback<
    { enrollment: object },
    Record<string, never>
  >(`/api/student/courses/${course.id}/enroll`, {
    successMessage: "Enrolled successfully!",
    errorMessage: "Could not enrol",
    onSuccess: () => onMutated(),
  })

  const { execute: unenroll, loading: unenrolling } = useDeleteCallback(
    `/api/student/courses/${course.id}/enroll`,
    { successMessage: "Unenrolled", errorMessage: "Could not unenrol", onSuccess: () => onMutated() },
  )

  return (
    <Card className={`overflow-hidden flex flex-col border-0 bg-card ${isCompleted ? "ring-1 ring-emerald-200" : ""}`}>
      {/* Thumbnail */}
      <div className="px-2 pt-2 shrink-0">
        <div className="aspect-video bg-muted flex items-center justify-center relative overflow-hidden rounded-xl">
          {course.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-contain" />
          ) : (
            <BookOpen className="size-10 text-muted-foreground/30" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-2">
            <Badge className={`text-[10px] border backdrop-blur-sm bg-white/90 ${levelColor[course.level]}`}>
              {course.level}
            </Badge>
          </div>
          {isCompleted && (
            <div className="absolute top-2 right-2">
              <Badge className="bg-emerald-500 text-white text-[10px] gap-1">
                <CheckCircle2 className="size-2.5" /> Done
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 px-4 pt-3 pb-4 gap-2.5">
        <div>
          <h3 className="font-bold text-sm leading-snug line-clamp-2">{course.title}</h3>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5">
            <span className="flex items-center gap-1"><BookOpen className="size-3" /> {course.lessonCount} lessons</span>
            <span className="flex items-center gap-1"><Users className="size-3" /> {course.enrollmentCount}</span>
            {course.avgRating && (
              <span className="flex items-center gap-1 ml-auto">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                <span className="font-semibold text-foreground">{course.avgRating}</span>
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        {course.isEnrolled && course.progress && (
          <div className="space-y-1">
            <Progress value={completion} className={`h-1.5 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{course.progress.completedLessons}/{course.progress.totalLessons} lessons</span>
              <span className={`font-bold ${isCompleted ? "text-emerald-600" : "text-foreground"}`}>{completion}%</span>
            </div>
          </div>
        )}

        {/* Action */}
        <div className="mt-auto">
          {course.isEnrolled ? (
            <div className="flex gap-2">
              <Button asChild size="sm" className="flex-1 h-8 text-xs">
                <Link href={`/student/lessons?courseId=${course.id}`}>
                  {isCompleted ? "Review" : "Continue"} <ArrowRight className="size-3 ml-1" />
                </Link>
              </Button>
              {course.canLeave && (
                <Button
                  variant="outline"
                  size="sm"
                  className="px-2 h-8 text-muted-foreground hover:text-destructive"
                  disabled={unenrolling}
                  onClick={() => {
                    if (window.confirm(`Leave "${course.title}"? Your progress on it will be cleared.`)) unenroll()
                  }}
                  title="Leave course"
                >
                  {unenrolling ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                </Button>
              )}
            </div>
          ) : (
            <Button size="sm" className="w-full h-8 text-xs" onClick={() => enroll({})} disabled={enrolling}>
              {enrolling ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {enrolling ? "Enrolling..." : "Enrol Free"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
