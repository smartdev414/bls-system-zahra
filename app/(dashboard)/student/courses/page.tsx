"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  BookOpen, Search, Star, Users, CheckCircle2,
  Loader2, Filter, ArrowRight, LogOut, Trophy, TrendingUp, Sparkles, X,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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
import { COURSE_LEVELS, levelColor, type CourseLevel } from "@/lib/levels"

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
  level: CourseLevel
  tutor: { id: string; name: string; avatarUrl: string | null }
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


export default function StudentCoursesPage() {
  const searchParams = useSearchParams()
  const [query, setQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState("all")
  const [tutorFilter, setTutorFilter] = useState(searchParams.get("tutorId") ?? "")
  const [page, setPage] = useState(1)

  // Sync tutorId from URL when navigating from tutor profile
  useEffect(() => {
    const id = searchParams.get("tutorId")
    if (id) setTutorFilter(id)
  }, [searchParams])

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (levelFilter !== "all") params.set("level", levelFilter)
  if (tutorFilter) params.set("tutorId", tutorFilter)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<CoursesData>(`/api/student/courses?${params.toString()}`, {
    errorMessage: "Could not load courses",
  })

  const completed = (data?.courses ?? []).filter((c) => c.progress?.isCompleted)
  const inProgress = (data?.courses ?? []).filter((c) => c.isEnrolled && !c.progress?.isCompleted)
  const available = (data?.courses ?? []).filter((c) => !c.isEnrolled)

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
            {COURSE_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Active tutor filter */}
      {tutorFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtered by tutor:</span>
          <button
            onClick={() => { setTutorFilter(""); setPage(1) }}
            className="inline-flex items-center gap-1 text-xs font-semibold bg-primary/10 text-primary rounded-full px-2.5 py-1 hover:bg-primary/20 transition-colors cursor-pointer"
          >
            Clear filter <X className="size-3" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-75">
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
                  <CourseCard key={c.id} course={c} onMutated={refetch} />
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
      <Card className={`overflow-hidden pt-2 flex flex-col group transition-all duration-200 border-0 bg-card ${isCompleted ? "ring-1 ring-emerald-200" : ""}`}>
        <div className="px-2 shrink-0">
          <div className="aspect-video bg-muted flex items-center justify-center relative overflow-hidden rounded-xl">
            {course.thumbnailUrl ? (
              <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />
            ) : (
              <BookOpen className="size-10 text-muted-foreground/30" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/30 via-transparent to-transparent" />
            <div className="absolute bottom-2 left-2">
              <Badge className={`text-[10px] border backdrop-blur-sm bg-white/90 shadow-sm ${levelColor[course.level]}`}>
                {course.level}
              </Badge>
            </div>
            <div className="absolute top-2 right-2">
              {isCompleted ? (
                <Badge className="bg-emerald-500 text-white text-[10px] shadow-sm gap-1">
                  <CheckCircle2 className="size-2.5" /> Completed
                </Badge>
              ) : course.isEnrolled ? (
                <Badge className="bg-primary/90 backdrop-blur-sm text-primary-foreground text-[10px] shadow-sm">Enrolled</Badge>
              ) : null}
            </div>
            {isCompleted && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-emerald-500 rounded-full p-3 shadow-xl ring-4 ring-white/30">
                  <Trophy className="size-5 text-white" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col flex-1 px-4 pt-3 pb-4 gap-3">
          <div>
            <h3 className="font-bold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
              {course.title}
            </h3>
            <Link
              href={`/student/tutors/${course.tutor.id}`}
              className="flex items-center gap-1.5 mt-1.5 group/tutor w-fit"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className="size-5 shrink-0">
                {course.tutor.avatarUrl && <AvatarImage src={course.tutor.avatarUrl} alt={course.tutor.name} />}
                <AvatarFallback className="text-[8px] bg-primary/10 text-primary font-bold">
                  {course.tutor.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-semibold text-primary truncate group-hover/tutor:underline">{course.tutor.name}</span>
            </Link>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><BookOpen className="size-3" /> {course.lessonCount} lessons</span>
            <span className="flex items-center gap-1"><Users className="size-3" /> {course.enrollmentCount}</span>
            {course.avgRating ? (
              <span className="flex items-center gap-1 ml-auto">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                <span className="font-semibold text-foreground">{course.avgRating}</span>
                <span>({course.reviewCount})</span>
              </span>
            ) : null}
          </div>

          {course.isEnrolled && progress && (
            <div className="space-y-1">
              <Progress
                value={completion}
                className={`h-1.5 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{progress.completedLessons}/{progress.totalLessons} lessons</span>
                <span className={`font-bold ${isCompleted ? "text-emerald-600" : "text-foreground"}`}>{completion}%</span>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-auto">
            {course.isEnrolled ? (
              <>
                {isCompleted ? (
                  <Button asChild size="sm" variant="outline" className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                    <Link href={`/student/lessons?courseId=${course.id}`}>
                      <CheckCircle2 className="size-3.5 mr-1.5" /> Review
                    </Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/student/lessons?courseId=${course.id}`}>
                      Continue <ArrowRight className="size-3.5 ml-1" />
                    </Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" className="px-2.5" onClick={() => setReviewOpen(true)} title="Rate course">
                  <Star className="size-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="px-2.5 text-muted-foreground hover:text-destructive hover:border-destructive" disabled={unenrolling} onClick={() => unenroll()} title="Unenrol">
                  {unenrolling ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                </Button>
              </>
            ) : (
              <Button size="sm" className="w-full" onClick={() => enroll({})} disabled={enrolling}>
                {enrolling ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                {enrolling ? "Enrolling…" : "Enrol Free"}
              </Button>
            )}
          </div>
        </div>
      </Card>

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
