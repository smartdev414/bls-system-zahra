"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BookOpen, Search, Star, Users, Layers, CheckCircle2,
  Loader2, Filter, ArrowRight, LogOut, Trophy, TrendingUp, Sparkles,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFetch, usePostCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseProgress = {
  completedLessons: number
  totalLessons: number
  completion: number
  isCompleted: boolean
}

type Course = {
  id: string
  title: string
  description: string
  thumbnailUrl: string | null
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  tutor: { id: string; name: string }
  category: { id: string; name: string } | null
  enrollmentCount: number
  sectionCount: number
  lessonCount: number
  avgRating: number | null
  reviewCount: number
  isEnrolled: boolean
  progress: CourseProgress | null
}

type CoursesData = {
  courses: Course[]
  total: number
  page: number
  totalPages: number
  recommendedCourses: Course[]
  invitedByTutor: { id: string; name: string; avatarUrl: string | null } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentCoursesPage() {
  const [query, setQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (levelFilter !== "all") params.set("level", levelFilter)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<CoursesData>(`/api/student/courses?${params.toString()}`, {
    errorMessage: "Could not load courses",
  })

  const completed  = (data?.courses ?? []).filter((c) => c.progress?.isCompleted)
  const inProgress = (data?.courses ?? []).filter((c) => c.isEnrolled && !c.progress?.isCompleted)
  const available  = (data?.courses ?? []).filter((c) => !c.isEnrolled)

  function handleLevelChange(value: string) {
    setLevelFilter(value)
    setPage(1)
  }

  const noResults = !loading && data?.courses.length === 0

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <BookOpen className="size-6 text-primary" /> Courses
        </h1>
        <p className="text-muted-foreground mt-1">Browse and enrol in BSL courses.</p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search courses or tutors..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={levelFilter} onValueChange={handleLevelChange}>
          <SelectTrigger className="w-40">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="BEGINNER">Beginner</SelectItem>
            <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
            <SelectItem value="ADVANCED">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : noResults ? (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6">
              <BookOpen className="size-10 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg">No courses found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {debouncedQuery || levelFilter !== "all" ? "Try adjusting your filters." : "No published courses yet."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Recommended courses — shown when student was invited by a tutor */}
          {data?.recommendedCourses && data.recommendedCourses.length > 0 && data.invitedByTutor && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary" />
                  Recommended by your tutor
                </h2>
                <div className="flex items-center gap-1.5 ml-1">
                  <Avatar className="size-5">
                    {data.invitedByTutor.avatarUrl && (
                      <AvatarImage src={data.invitedByTutor.avatarUrl} alt={data.invitedByTutor.name} />
                    )}
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-bold">
                      {data.invitedByTutor.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground font-medium">{data.invitedByTutor.name}</span>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.recommendedCourses.map((c) => (
                  <div key={c.id} className="relative">
                    <div className="absolute -top-2 -right-2 z-10">
                      <span className="flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full shadow">
                        <Sparkles className="size-2.5" /> Recommended
                      </span>
                    </div>
                    <CourseCard course={c} onMutated={refetch} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Completed courses */}
          {completed.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Trophy className="size-3.5 text-amber-500" />
                Completed
                <Badge variant="secondary" className="text-xs font-semibold">{completed.length}</Badge>
              </h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {completed.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          {/* In-progress courses */}
          {inProgress.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <TrendingUp className="size-3.5 text-primary" />
                In Progress
                <Badge variant="secondary" className="text-xs font-semibold">{inProgress.length}</Badge>
              </h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          {/* Available courses */}
          {available.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <BookOpen className="size-3.5" />
                Available Courses
                <Badge variant="secondary" className="text-xs font-semibold">{available.length}</Badge>
              </h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          {data && data.totalPages > 1 && (
            <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}

// ─── Course card ──────────────────────────────────────────────────────────────

function CourseCard({ course, onMutated }: { course: Course; onMutated: () => void }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")

  const progress = course.progress
  const isCompleted = progress?.isCompleted ?? false
  const completion = progress?.completion ?? 0

  const { execute: enroll, loading: enrolling } = usePostCallback<
    { enrollment: object },
    Record<string, never>
  >(`/api/student/courses/${course.id}/enroll`, {
    successMessage: "Enrolled successfully!",
    errorMessage: "Could not enrol",
    onSuccess: () => onMutated(),
  })

  const { execute: submitReview, loading: submitting } = usePostCallback<
    { review: object },
    { rating: number; comment: string }
  >(`/api/student/courses/${course.id}/review`, {
    successMessage: "Review submitted!",
    errorMessage: "Could not submit review",
    onSuccess: () => { setReviewOpen(false); setComment(""); setRating(5); onMutated() },
  })

  const { execute: unenroll, loading: unenrolling } = useDeleteCallback(
    `/api/student/courses/${course.id}/enroll`,
    {
      successMessage: "Unenrolled successfully",
      errorMessage: "Could not unenrol",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <>
      <Card className={`shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow ${isCompleted ? "ring-1 ring-emerald-200" : ""}`}>
        {/* Thumbnail */}
        <div className="aspect-video bg-primary/10 flex items-center justify-center relative overflow-hidden shrink-0">
          {course.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-cover" />
          ) : (
            <BookOpen className="size-10 text-primary/40" />
          )}
          {/* Level badge */}
          <div className="absolute top-2 left-2">
            <Badge variant="outline" className={`text-[10px] backdrop-blur-sm bg-white/80 ${levelColor[course.level]}`}>
              {course.level.charAt(0) + course.level.slice(1).toLowerCase()}
            </Badge>
          </div>
          {/* Status badge */}
          <div className="absolute top-2 right-2">
            {isCompleted ? (
              <Badge className="bg-emerald-500 text-white text-[10px] gap-1">
                <CheckCircle2 className="size-2.5" /> Completed
              </Badge>
            ) : course.isEnrolled ? (
              <Badge className="bg-primary text-primary-foreground text-[10px]">Enrolled</Badge>
            ) : null}
          </div>
          {/* Completion overlay on thumbnail */}
          {isCompleted && (
            <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
              <div className="bg-emerald-500 rounded-full p-3 shadow-lg">
                <Trophy className="size-6 text-white" />
              </div>
            </div>
          )}
        </div>

        <CardHeader className="pb-2 flex-1">
          <CardTitle className="text-base leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {course.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">by {course.tutor.name}</p>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{course.description}</p>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Course meta */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><Layers className="size-3" /> {course.sectionCount} sections</span>
            <span className="flex items-center gap-1"><BookOpen className="size-3" /> {course.lessonCount} lessons</span>
            <span className="flex items-center gap-1"><Users className="size-3" /> {course.enrollmentCount}</span>
          </div>

          {course.avgRating && (
            <div className="flex items-center gap-1 text-xs">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{course.avgRating}</span>
              <span className="text-muted-foreground">({course.reviewCount})</span>
            </div>
          )}

          {/* Progress bar for enrolled courses */}
          {course.isEnrolled && progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {progress.completedLessons} / {progress.totalLessons} lessons
                </span>
                <span className={`font-semibold ${isCompleted ? "text-emerald-600" : "text-foreground"}`}>
                  {completion}%
                </span>
              </div>
              <Progress
                value={completion}
                className={`h-1.5 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`}
              />
            </div>
          )}

          {/* Actions */}
          {course.isEnrolled ? (
            <div className="flex gap-2">
              {isCompleted ? (
                <Button asChild size="sm" variant="outline" className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                  <Link href={`/student/lessons?courseId=${course.id}`}>
                    <CheckCircle2 className="size-3.5 mr-1.5" /> Review
                  </Link>
                </Button>
              ) : (
                <Button asChild size="sm" className="flex-1">
                  <Link href={`/student/lessons?courseId=${course.id}`}>
                    Continue <ArrowRight className="size-4 ml-1" />
                  </Link>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)} title="Rate course">
                <Star className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={unenrolling}
                onClick={() => unenroll()}
                title="Unenrol"
                className="text-muted-foreground hover:text-destructive"
              >
                {unenrolling ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              </Button>
            </div>
          ) : (
            <Button size="sm" className="w-full" onClick={() => enroll({})} disabled={enrolling}>
              {enrolling && <Loader2 className="size-4 animate-spin mr-1.5" />}
              {enrolling ? "Enrolling..." : "Enrol Free"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Review dialog */}
      <Dialog open={reviewOpen} onOpenChange={(open: boolean) => !open && setReviewOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rate this course</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm font-semibold line-clamp-1">{course.title}</p>
            <div className="flex flex-col gap-1.5">
              <Label>Your rating</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)}>
                    <Star className={`size-7 transition-colors ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Comment (optional)</Label>
              <Textarea
                placeholder="Share your experience..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => submitReview({ rating, comment })}>
              {submitting ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
