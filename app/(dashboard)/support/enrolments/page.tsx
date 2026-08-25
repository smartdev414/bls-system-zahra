"use client"

import { useState } from "react"
import {
  UserPlus, Search, Loader2, BookOpen, Users, X, Check,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from "sonner"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { levelColorSolid, type CourseLevel } from "@/lib/levels"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseItem = {
  id: string
  title: string
  level: CourseLevel
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  tutor: { id: string; name: string }
  enrollmentCount: number
}

type Student = { id: string; name: string; email: string; avatarUrl: string | null }

type Enrolment = {
  id: string
  enrolledAt: string
  student: Student & { bslLevel: string | null }
}

function initialsOf(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SupportEnrolmentsPage() {
  const [courseQuery, setCourseQuery] = useState("")
  const [selected, setSelected] = useState<CourseItem | null>(null)

  const debouncedCourseQuery = useDebounce(courseQuery)
  const courseParams = new URLSearchParams()
  if (debouncedCourseQuery) courseParams.set("q", debouncedCourseQuery)

  const { data: courseData, loading: coursesLoading } = useFetch<{ courses: CourseItem[] }>(
    `/api/admin/courses?${courseParams.toString()}`,
    { errorMessage: "Could not load courses" },
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <UserPlus className="size-6 text-primary" /> Enrolments
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Put students onto a course without waiting for them to sign up themselves.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6 items-start">
        {/* Course picker */}
        <Card className="shadow-sm">
          <CardContent className="p-4 flex flex-col gap-3">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              1. Choose a course
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search courses…"
                value={courseQuery}
                onChange={(e) => setCourseQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {coursesLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : courseData?.courses.length ? (
              <div className="flex flex-col gap-1.5 max-h-[26rem] overflow-y-auto">
                {courseData.courses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      selected?.id === c.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
                      <BookOpen className="size-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{c.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.tutor.name} · {c.enrollmentCount} enrolled
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${levelColorSolid[c.level]}`}>
                      {c.level}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No courses found.</p>
            )}
          </CardContent>
        </Card>

        {/* Enrolment panel */}
        {selected ? (
          <CourseEnrolments course={selected} />
        ) : (
          <Card className="shadow-sm">
            <CardContent className="py-20 flex flex-col items-center gap-3 text-center">
              <Users className="size-10 text-muted-foreground" />
              <p className="font-semibold">Pick a course to manage its students</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── Enrolments for one course ────────────────────────────────────────────────

function CourseEnrolments({ course }: { course: CourseItem }) {
  const [studentQuery, setStudentQuery] = useState("")
  const [picked, setPicked] = useState<Student[]>([])
  const [saving, setSaving] = useState(false)

  const debouncedStudentQuery = useDebounce(studentQuery)

  const { data: enrolData, loading, refetch } = useFetch<{ enrolments: Enrolment[]; total: number }>(
    `/api/admin/enrolments?courseId=${course.id}`,
    { errorMessage: "Could not load enrolments" },
  )

  const { data: searchData } = useFetch<{ students: Student[] }>(
    `/api/tutor/students/search?q=${encodeURIComponent(debouncedStudentQuery)}`,
    { errorMessage: false },
  )

  const enrolledIds = new Set((enrolData?.enrolments ?? []).map((e) => e.student.id))
  const pickedIds = new Set(picked.map((s) => s.id))
  const candidates = (searchData?.students ?? []).filter(
    (s) => !enrolledIds.has(s.id) && !pickedIds.has(s.id),
  )

  async function addPicked() {
    if (picked.length === 0) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/enrolments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: course.id, studentIds: picked.map((s) => s.id) }),
      })
      const body = await res.json() as { added?: number; message?: string }
      if (!res.ok) {
        toast.error(body.message ?? "Could not add students")
        return
      }
      toast.success(`${body.added ?? 0} student${body.added === 1 ? "" : "s"} added to "${course.title}"`)
      setPicked([])
      setStudentQuery("")
      void refetch()
    } finally {
      setSaving(false)
    }
  }

  async function remove(studentId: string) {
    const res = await fetch(
      `/api/admin/enrolments?courseId=${course.id}&studentId=${studentId}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      const body = await res.json() as { message?: string }
      toast.error(body.message ?? "Could not remove student")
      return
    }
    toast.success("Student removed from the course")
    void refetch()
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex flex-col gap-4">
        <div>
          <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            2. Add students to “{course.title}”
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Tutor: {course.tutor.name}
          </p>
        </div>

        {/* Picked, awaiting save */}
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((s) => (
              <Badge key={s.id} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
                {s.name}
                <button
                  onClick={() => setPicked((prev) => prev.filter((p) => p.id !== s.id))}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  aria-label={`Remove ${s.name}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search students by name or email…"
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={addPicked} disabled={picked.length === 0 || saving} className="gap-1.5 shrink-0">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Add {picked.length > 0 ? picked.length : ""}
          </Button>
        </div>

        {studentQuery && candidates.length > 0 && (
          <div className="flex flex-col gap-1 rounded-xl border p-1 max-h-56 overflow-y-auto">
            {candidates.map((s) => (
              <button
                key={s.id}
                onClick={() => setPicked((prev) => [...prev, s])}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50"
              >
                <Avatar className="size-6 shrink-0">
                  {s.avatarUrl && <AvatarImage src={s.avatarUrl} alt={s.name} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                    {initialsOf(s.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Already enrolled */}
        <div className="border-t pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Enrolled ({enrolData?.total ?? 0})
          </p>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : enrolData?.enrolments.length ? (
            <div className="flex flex-col divide-y max-h-72 overflow-y-auto">
              {enrolData.enrolments.map((e) => (
                <div key={e.id} className="flex items-center gap-2.5 py-2">
                  <Avatar className="size-7 shrink-0">
                    {e.student.avatarUrl && <AvatarImage src={e.student.avatarUrl} alt={e.student.name} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                      {initialsOf(e.student.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{e.student.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{e.student.email}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                    {new Date(e.enrolledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => remove(e.student.id)}
                    aria-label={`Remove ${e.student.name}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No students on this course yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
