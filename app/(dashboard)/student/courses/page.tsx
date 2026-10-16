"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  BookOpen, Search, Star, Users, CheckCircle2,
  Loader2, Filter, ArrowRight, LogOut, Trophy, Sparkles, X, MoreHorizontal, PlayCircle,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  canLeave?: boolean
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

// Below this many courses a search box is just clutter: everything is on screen.
const SEARCH_THRESHOLD = 6

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

  const courses = data?.courses ?? []
  // The student's own courses come first: unfinished ones (what they came here
  // to carry on with), then finished ones.
  const myCourses = [
    ...courses.filter((c) => c.isEnrolled && !c.progress?.isCompleted),
    ...courses.filter((c) => c.progress?.isCompleted),
  ]
  const recommended = data?.invitedByTutor
    ? (data.recommendedCourses ?? []).filter((c) => !c.isEnrolled)
    : []
  const recommendedIds = new Set(recommended.map((c) => c.id))
  const available = courses.filter((c) => !c.isEnrolled && !recommendedIds.has(c.id))

  function handleLevelChange(value: string) {
    setLevelFilter(value)
    setPage(1)
  }

  const filtering = Boolean(query || levelFilter !== "all")
  const showFilters = filtering || (data?.total ?? 0) > SEARCH_THRESHOLD
  const noResults = !loading && courses.length === 0

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <BookOpen className="size-6 text-primary" /> Courses
        </h1>
        <p className="text-muted-foreground mt-1">
          {myCourses.length > 0 ? "Pick up where you left off, or start something new." : "Browse and enrol in BSL courses."}
        </p>
      </div>

      {showFilters && (
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
            <SelectTrigger className="w-full sm:w-40">
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
      )}

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
              <p className="font-semibold text-lg">{filtering ? "No courses found" : "No courses yet"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {filtering
                  ? "Try adjusting your filters."
                  : "Your class will appear here as soon as your teacher adds you to it."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {myCourses.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeading icon={<PlayCircle className="size-3.5 text-primary" />} title="My courses" />
              <div className="grid gap-4 lg:grid-cols-2">
                {myCourses.map((c) => <MyCourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          {recommended.length > 0 && data?.invitedByTutor && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <SectionHeading icon={<Sparkles className="size-3.5 text-primary" />} title="Recommended by your tutor" />
                <div className="flex items-center gap-1.5">
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
                {recommended.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          {available.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeading
                icon={<BookOpen className="size-3.5" />}
                title={myCourses.length > 0 ? "More courses" : "Available courses"}
              />
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

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
      {icon}
      {title}
    </h2>
  )
}

/** Course image, or a tinted panel with the level when the tutor didn't upload one. */
function CourseThumb({ course, className = "" }: { course: Course; className?: string }) {
  return (
    <div className={`aspect-video relative overflow-hidden rounded-xl ${className}`}>
      {course.thumbnailUrl ? (
        <>
          <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-cover bg-muted" />
          <div className="absolute bottom-2 left-2">
            <Badge className={`text-[10px] border shadow-sm ${levelColor[course.level]}`}>{course.level}</Badge>
          </div>
        </>
      ) : (
        <div className={`w-full h-full flex flex-col items-center justify-center gap-1 border ${levelColor[course.level]}`}>
          <span className="text-xl sm:text-3xl font-black tracking-tight">{course.level}</span>
          <span className="hidden sm:block text-[11px] font-semibold uppercase tracking-wider opacity-70">BSL course</span>
        </div>
      )}
    </div>
  )
}

function TutorLine({ tutor }: { tutor: Course["tutor"] }) {
  return (
    <Link href={`/student/tutors/${tutor.id}`} className="flex items-center gap-1.5 group/tutor w-fit max-w-full">
      <Avatar className="size-5 shrink-0">
        {tutor.avatarUrl && <AvatarImage src={tutor.avatarUrl} alt={tutor.name} />}
        <AvatarFallback className="text-[8px] bg-primary/10 text-primary font-bold">
          {tutor.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-muted-foreground truncate group-hover/tutor:text-primary group-hover/tutor:underline">
        {tutor.name}
      </span>
    </Link>
  )
}

/**
 * A course the student is enrolled in. One obvious button to get back into
 * it; rating and leaving sit in a menu so a stray tap can't unenrol anyone.
 */
function MyCourseCard({ course, onMutated }: { course: Course; onMutated: () => void }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const progress = course.progress
  const isCompleted = progress?.isCompleted ?? false
  const completion = progress?.completion ?? 0
  const started = (progress?.completedLessons ?? 0) > 0

  const { execute: unenroll, loading: unenrolling } = useDeleteCallback(
    `/api/student/courses/${course.id}/enroll`,
    {
      successMessage: "You have left the course",
      errorMessage: "Could not leave the course",
      onSuccess: () => { setLeaveOpen(false); onMutated() },
    }
  )

  const href = `/student/lessons?courseId=${course.id}`

  return (
    <>
      <Card className={`p-3 flex flex-row gap-3 sm:gap-4 shadow-sm ${isCompleted ? "ring-1 ring-emerald-200" : ""}`}>
        <Link href={href} className="w-24 sm:w-44 shrink-0 self-start">
          <CourseThumb course={course} />
        </Link>

        <div className="flex flex-col flex-1 min-w-0 gap-3 sm:py-1 sm:pr-1">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link href={href} className="font-bold leading-snug line-clamp-2 hover:text-primary transition-colors">
                {course.title}
              </Link>
              <div className="mt-1"><TutorLine tutor={course.tutor} /></div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 shrink-0 -mt-1 -mr-1" aria-label="Course options">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setReviewOpen(true)}>
                  <Star className="size-4" /> Rate this course
                </DropdownMenuItem>
                {course.canLeave && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setLeaveOpen(true)}>
                      <LogOut className="size-4" /> Leave course
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-1.5">
            <Progress value={completion} className={`h-2 ${isCompleted ? "[&>div]:bg-emerald-500" : ""}`} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {isCompleted ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <Trophy className="size-3.5" /> Completed
                  </span>
                ) : (
                  `${progress?.completedLessons ?? 0} of ${progress?.totalLessons ?? course.lessonCount} lessons done`
                )}
              </span>
              <span className="font-bold text-foreground">{completion}%</span>
            </div>
          </div>

          {isCompleted ? (
            <Button asChild variant="outline" className="mt-auto border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              <Link href={href}><CheckCircle2 className="size-4 mr-1.5" /> Review lessons</Link>
            </Button>
          ) : (
            <Button asChild className="mt-auto">
              <Link href={href}>
                {started ? "Continue" : "Start course"} <ArrowRight className="size-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      </Card>

      <ReviewDialog course={course} open={reviewOpen} onOpenChange={setReviewOpen} onMutated={onMutated} />

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave this course?</DialogTitle>
            <DialogDescription>
              {course.title} will be removed from your courses and your progress on it will be cleared. You can enrol again later and start afresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>Stay enrolled</Button>
            <Button variant="destructive" disabled={unenrolling} onClick={() => unenroll()}>
              {unenrolling && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Leave course
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A course the student can enrol in. */
function CourseCard({ course, onMutated }: { course: Course; onMutated: () => void }) {
  const { execute: enroll, loading: enrolling } = usePostCallback<
    { enrollment: object },
    Record<string, never>
  >(`/api/student/courses/${course.id}/enroll`, {
    successMessage: "Enrolled successfully!",
    errorMessage: "Could not enrol",
    onSuccess: () => onMutated(),
  })

  return (
    <Card className="overflow-hidden p-2 flex flex-col gap-0 shadow-sm">
      <CourseThumb course={course} />

      <div className="flex flex-col flex-1 px-2 pt-3 pb-1 gap-3">
        <div>
          <h3 className="font-bold text-sm leading-snug line-clamp-2">{course.title}</h3>
          <div className="mt-1.5"><TutorLine tutor={course.tutor} /></div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><BookOpen className="size-3" /> {course.lessonCount} lessons</span>
          <span className="flex items-center gap-1" title="Students enrolled"><Users className="size-3" /> {course.enrollmentCount} students</span>
          {course.avgRating ? (
            <span className="flex items-center gap-1 ml-auto">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-semibold text-foreground">{course.avgRating}</span>
              <span>({course.reviewCount})</span>
            </span>
          ) : null}
        </div>

        <Button className="w-full mt-auto" onClick={() => enroll({})} disabled={enrolling}>
          {enrolling ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
          {enrolling ? "Enrolling…" : "Enrol free"}
        </Button>
      </div>
    </Card>
  )
}

function ReviewDialog({ course, open, onOpenChange, onMutated }: {
  course: Course
  open: boolean
  onOpenChange: (open: boolean) => void
  onMutated: () => void
}) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")

  const { execute: submitReview, loading: submitting } = usePostCallback<
    { review: object },
    { rating: number; comment: string }
  >(`/api/student/courses/${course.id}/review`, {
    successMessage: "Review submitted!",
    errorMessage: "Could not submit review",
    onSuccess: () => { onOpenChange(false); setComment(""); setRating(5); onMutated() },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <button key={n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={submitting} onClick={() => submitReview({ rating, comment })}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
