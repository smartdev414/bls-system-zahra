"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  BookOpen, PlayCircle, FileText, FlaskConical,
  Clock, CheckCircle2, Loader2, Lock, ChevronRight, CalendarClock,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useState } from "react"
import { useFetch } from "@/hooks/use-fetch"
import { Pagination } from "@/components/ui/pagination"
import { levelColor, type CourseLevel } from "@/lib/levels"
import { releaseLabel } from "@/lib/lesson-release"

type LessonItem = {
  id: string
  title: string
  type: "VIDEO" | "TEXT" | "QUIZ"
  order: number
  isFree: boolean
  duration: number | null
  isCompleted: boolean
  watchedSecs: number
  /** Held back until `releaseAt`: listed, but cannot be opened yet. */
  locked: boolean
  releaseAt: string | null
}

type SectionItem = {
  id: string
  title: string
  order: number
  lessons: LessonItem[]
}

type CourseEnrollment = {
  enrollmentId: string
  enrolledAt: string
  course: {
    id: string
    title: string
    description: string
    thumbnailUrl: string | null
    level: CourseLevel
    tutor: { name: string; avatarUrl: string | null }
  }
  stats: { totalLessons: number; completedLessons: number; completion: number; lockedLessons: number }
  /** When the next locked lesson opens, if any are still to come. */
  nextReleaseAt: string | null
  lastLessonId: string | null
  sections: SectionItem[]
}

type LessonsData = { courses: CourseEnrollment[] }

const typeIcon = {
  VIDEO: PlayCircle,
  TEXT: FileText,
  QUIZ: FlaskConical,
}


function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const PAGE_SIZE = 5

export default function LessonsPage() {
  const [page, setPage] = useState(1)
  const searchParams = useSearchParams()
  const courseId = searchParams.get("courseId")

  const apiUrl = courseId ? `/api/student/lessons?courseId=${courseId}` : "/api/student/lessons"
  const { data, loading } = useFetch<LessonsData>(apiUrl, {
    errorMessage: "Could not load lessons",
  })

  const allCourses = data?.courses ?? []
  const totalPages = Math.ceil(allCourses.length / PAGE_SIZE)
  const pagedCourses = allCourses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.courses.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
        <div className="rounded-full bg-primary/10 p-6">
          <BookOpen className="size-10 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">No courses yet</h2>
          <p className="text-muted-foreground mt-1">You haven&apos;t been enrolled in any courses.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          {courseId && pagedCourses[0] ? pagedCourses[0].course.title : "My Lessons"}
        </h1>
        <p className="text-muted-foreground mt-1">Continue your BSL learning journey.</p>
      </div>

      {pagedCourses.map((enrollment) => (
        <Card key={enrollment.enrollmentId} className="shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className={`text-xs ${levelColor[enrollment.course.level] ?? ""}`} variant="outline">
                    {enrollment.course.level}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    by {enrollment.course.tutor.name}
                  </span>
                </div>
                <CardTitle className="text-lg">{enrollment.course.title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {enrollment.course.description}
                </p>
              </div>

              {enrollment.lastLessonId && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href={`/student/lessons/${enrollment.lastLessonId}`}>
                    Continue <ChevronRight className="size-4 ml-1" />
                  </Link>
                </Button>
              )}
            </div>

            {/* Course progress */}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>{enrollment.stats.completedLessons} of {enrollment.stats.totalLessons} lessons completed</span>
                <span className="font-semibold text-foreground">{enrollment.stats.completion}%</span>
              </div>
              <Progress value={enrollment.stats.completion} className="h-2" />
              {enrollment.nextReleaseAt && (
                <p className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5 text-amber-600" />
                  {enrollment.stats.lockedLessons === 1 ? "1 lesson is" : `${enrollment.stats.lockedLessons} lessons are`} still locked.
                  The next opens {releaseLabel(enrollment.nextReleaseAt)}.
                </p>
              )}
            </div>
          </CardHeader>

          {/* Sections and lessons */}
          <CardContent className="p-0">
            {enrollment.sections.map((section, si) => (
              <div key={section.id}>
                {si > 0 && <div className="border-t" />}
                {/* Section header */}
                <div className="px-6 py-3 bg-muted/10">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Section {section.order}: {section.title}
                  </p>
                </div>
                {/* Lesson rows */}
                {section.lessons.map((lesson) => {
                  const Icon = typeIcon[lesson.type]
                  if (lesson.locked) {
                    // Not a link: the student can see what is coming and when,
                    // but nothing opens until the release date.
                    return (
                      <div
                        key={lesson.id}
                        aria-disabled="true"
                        className="flex items-center gap-4 px-6 py-3.5 border-t first:border-t-0 bg-muted/10 text-muted-foreground"
                      >
                        <div className="shrink-0">
                          <div className="size-5 rounded-full border-2 border-dashed border-muted-foreground/30" />
                        </div>
                        <div className="shrink-0 rounded-lg p-2 bg-muted">
                          <Lock className="size-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">
                            {lesson.order}. {lesson.title}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5 text-xs">
                            <CalendarClock className="size-3" />
                            Unlocks {lesson.releaseAt ? releaseLabel(lesson.releaseAt) : "later"}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                          <Lock className="size-2.5" /> Locked
                        </Badge>
                      </div>
                    )
                  }
                  return (
                    <Link
                      key={lesson.id}
                      href={`/student/lessons/${lesson.id}`}
                      className="flex items-center gap-4 px-6 py-3.5 border-t first:border-t-0 hover:bg-muted/30 transition-colors group"
                    >
                      {/* Completion indicator */}
                      <div className="shrink-0">
                        {lesson.isCompleted ? (
                          <CheckCircle2 className="size-5 text-emerald-500" />
                        ) : (
                          <div className="size-5 rounded-full border-2 border-muted-foreground/30 group-hover:border-primary transition-colors" />
                        )}
                      </div>

                      {/* Type icon */}
                      <div className={`shrink-0 rounded-lg p-2 ${lesson.isCompleted ? "bg-emerald-50" : "bg-primary/10"}`}>
                        <Icon className={`size-4 ${lesson.isCompleted ? "text-emerald-600" : "text-primary"}`} />
                      </div>

                      {/* Lesson info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug ${lesson.isCompleted ? "text-muted-foreground" : ""}`}>
                          {lesson.order}. {lesson.title}
                        </p>
                        {lesson.type === "VIDEO" && lesson.duration && (
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            {formatDuration(lesson.duration)}
                          </div>
                        )}
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        {lesson.isFree && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">Free</Badge>
                        )}
                        <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
