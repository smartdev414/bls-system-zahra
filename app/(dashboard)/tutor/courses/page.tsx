"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BookOpen, Users, Layers, FileText,
  Loader2, ChevronRight, Globe, Lock, Archive,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useFetch } from "@/hooks/use-fetch"
import { Pagination } from "@/components/ui/pagination"
import { levelColorSolid, type CourseLevel } from "@/lib/levels"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseItem = {
  id: string
  title: string
  slug: string
  description: string
  thumbnailUrl: string | null
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  level: CourseLevel
  category: { id: string; name: string } | null
  enrollmentCount: number
  sectionCount: number
  lessonCount: number
  createdAt: string
  updatedAt: string
}

type CoursesData = { courses: CourseItem[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusIcon = { PUBLISHED: Globe, DRAFT: Lock, ARCHIVED: Archive }
const statusColor: Record<string, string> = {
  PUBLISHED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  DRAFT: "bg-amber-100 text-amber-700 border-amber-200",
  ARCHIVED: "bg-muted text-muted-foreground",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12

// The school builds its courses centrally; a tutor sees the ones they have been
// put on and works from them — lessons to follow, students, and class sessions.
export default function TutorCoursesPage() {
  const { data, loading } = useFetch<CoursesData>("/api/tutor/courses", {
    errorMessage: "Could not load courses",
  })

  const [page, setPage] = useState(1)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">My Courses</h1>
          <p className="text-muted-foreground mt-1">The courses you teach — lessons, students and class sessions.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-75">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.courses.length ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((course) => {
              const StatusIcon = statusIcon[course.status]
              return (
                <Card key={course.id} className="overflow-hidden group border-0 bg-card pt-0">
                  <div className="p-3 pb-0">
                    <div className="aspect-video bg-primary/10 flex items-center justify-center relative overflow-hidden rounded-lg">
                      {course.thumbnailUrl ? (
                        <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-cover" />
                      ) : (
                        <BookOpen className="size-10 text-primary/40" />
                      )}
                      <div className="absolute top-2 right-2">
                        <Badge variant="outline" className={`text-xs ${statusColor[course.status]}`}>
                          <StatusIcon className="size-3 mr-1" />
                          {course.status.charAt(0) + course.status.slice(1).toLowerCase()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug group-hover:text-primary transition-colors">
                        {course.title}
                      </CardTitle>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${levelColorSolid[course.level]}`}>
                        {course.level}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                  </CardHeader>

                  <CardContent className="pt-0 space-y-4">
                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="size-3" /> {course.enrollmentCount} students
                      </div>
                      <div className="flex items-center gap-1">
                        <Layers className="size-3" /> {course.sectionCount} sections
                      </div>
                      <div className="flex items-center gap-1">
                        <FileText className="size-3" /> {course.lessonCount} lessons
                      </div>
                    </div>

                    <Button asChild className="w-full" size="sm" variant="outline">
                      <Link href={`/tutor/courses/${course.id}`}>
                        Open Course <ChevronRight className="size-4 ml-1" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {Math.ceil((data.courses.length) / PAGE_SIZE) > 1 && (
            <Pagination
              page={page}
              totalPages={Math.ceil(data.courses.length / PAGE_SIZE)}
              onPageChange={setPage}
              className="mt-2"
            />
          )}
        </>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-primary/10 p-6">
              <BookOpen className="size-10 text-primary" />
            </div>
            <div>
              <p className="font-bold text-lg">No courses yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Courses are set up by the school. Once you are added to one as a teacher, it appears here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
