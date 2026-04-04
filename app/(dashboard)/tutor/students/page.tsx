"use client"

import { useState } from "react"
import { Users, Search, BookOpen, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseProgress = {
  id: string
  title: string
  enrolledAt: string
  totalLessons: number
  completedLessons: number
  completion: number
}

type Student = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  joinedAt: string
  courses: CourseProgress[]
}

type StudentsData = { students: Student[]; total: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function TutorStudentsPage() {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  params.set("page", String(page))

  const { data, loading } = useFetch<StudentsData>(`/api/tutor/students?${params.toString()}`, {
    errorMessage: "Could not load students",
  })

  const students = data?.students ?? []
  const totalPages = Math.ceil(students.length / PAGE_SIZE)
  const paginated = students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Users className="size-6 text-primary" /> Students
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading ? "\u00A0" : `${data?.total ?? 0} student${data?.total !== 1 ? "s" : ""} enrolled across your courses`}
          </p>
        </div>

        <div className="relative w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search students..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : paginated.length ? (
        <div className="flex flex-col gap-3">
          {paginated.map((student) => {
            const isExpanded = expandedId === student.id
            const initials = student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
            const overallCompletion = student.courses.length > 0
              ? Math.round(student.courses.reduce((s, c) => s + c.completion, 0) / student.courses.length)
              : 0

            return (
              <Card key={student.id} className="shadow-sm overflow-hidden">
                {/* Student row */}
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                  onClick={() => setExpandedId(isExpanded ? null : student.id)}
                >
                  <Avatar className="size-10 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{student.name}</p>
                      {student.bslLevel && (
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${levelColor[student.bslLevel] ?? ""}`}>
                          {student.bslLevel.charAt(0) + student.bslLevel.slice(1).toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <div className="flex flex-col items-end gap-1 w-28 hidden sm:flex">
                      <span className="text-xs font-semibold">{overallCompletion}% overall</span>
                      <Progress value={overallCompletion} className="h-1.5 w-full" />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BookOpen className="size-3.5" />
                      {student.courses.length} course{student.courses.length !== 1 ? "s" : ""}
                    </div>
                    {isExpanded
                      ? <ChevronUp className="size-4 text-muted-foreground" />
                      : <ChevronDown className="size-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* Expanded course list */}
                {isExpanded && (
                  <div className="border-t">
                    <div className="px-5 py-2 bg-muted/20">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Enrolled Courses
                      </p>
                    </div>
                    {student.courses.map((course, i) => (
                      <div key={course.id} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? "border-t" : ""}`}>
                        <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
                          <BookOpen className="size-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{course.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {course.completedLessons}/{course.totalLessons} lessons ·{" "}
                            Enrolled {new Date(course.enrolledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 w-24 shrink-0">
                          <span className="text-xs font-semibold">{course.completion}%</span>
                          <Progress value={course.completion} className="h-1.5 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6">
              <Users className="size-10 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg">
                {debouncedQuery ? "No students match your search" : "No students yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {debouncedQuery
                  ? "Try a different name or email."
                  : "Students will appear here once they enrol in your courses."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-2" />
      )}
    </div>
  )
}
