"use client"

import { useState } from "react"
import {
  BookOpen, Search, Loader2, Globe, Lock, Archive,
  Star, Users, Filter, Plus,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"
import { Pagination } from "@/components/ui/pagination"
import { COURSE_LEVELS, levelColorSolid, levelLabel, type CourseLevel } from "@/lib/levels"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseItem = {
  id: string
  title: string
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  level: CourseLevel
  tutor: { id: string; name: string }
  category: { name: string } | null
  enrollmentCount: number
  sectionCount: number
  avgRating: number | null
  reviewCount: number
  createdAt: string
}

type CoursesData = { courses: CourseItem[]; total: number; page: number; totalPages: number }

const statusConfig = {
  PUBLISHED: { label: "Published", icon: Globe, className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  DRAFT:     { label: "Draft",     icon: Lock,  className: "bg-amber-100 text-amber-700 border-amber-200" },
  ARCHIVED:  { label: "Archived",  icon: Archive, className: "bg-muted text-muted-foreground" },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CoursesManager({ canCreate = true }: { canCreate?: boolean } = {}) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)

  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)
  if (statusFilter !== "all") params.set("status", statusFilter)
  params.set("page", String(page))

  const { data, loading, refetch } = useFetch<CoursesData>(`/api/admin/courses?${params.toString()}`, {
    errorMessage: "Could not load courses",
  })

  function handleStatusChange(value: string) {
    setStatusFilter(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <BookOpen className="size-6 text-primary" /> Courses
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading ? "\u00A0" : `${data?.total ?? 0} course${data?.total !== 1 ? "s" : ""} on the platform`}
          </p>
        </div>
        {canCreate && <NewCourseDialog onCreated={refetch} />}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search courses..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-36">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : data?.courses.length ? (
        <div className="flex flex-col gap-3">
          {data.courses.map((course) => (
            <CourseRow key={course.id} course={course} onMutated={refetch} />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <BookOpen className="size-10 text-muted-foreground" />
            <p className="font-semibold">No courses found</p>
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} className="mt-2" />
      )}
    </div>
  )
}

// ─── Course row ───────────────────────────────────────────────────────────────

function CourseRow({ course, onMutated }: { course: CourseItem; onMutated: () => void }) {
  const cfg = statusConfig[course.status]
  const StatusIcon = cfg.icon

  const { execute: updateStatus, loading: updating } = usePatchCallback<
    { course: CourseItem },
    { id: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED" }
  >("/api/admin/courses", {
    successMessage: (d) => `Course ${(d as { course: { status: string } }).course.status.toLowerCase()}`,
    errorMessage: "Could not update course",
    onSuccess: () => onMutated(),
  })

  const nextStatus = course.status === "PUBLISHED" ? "DRAFT"
    : course.status === "DRAFT" ? "PUBLISHED"
    : "PUBLISHED"

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="rounded-xl bg-primary/10 p-3 shrink-0">
              <BookOpen className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.className}`}>
                  <StatusIcon className="size-2.5" /> {cfg.label}
                </Badge>
                <Badge variant="outline" className={`text-[10px] ${levelColorSolid[course.level]}`}>
                  {course.level}
                </Badge>
                {course.category && (
                  <Badge variant="secondary" className="text-[10px]">{course.category.name}</Badge>
                )}
              </div>
              <p className="font-semibold leading-snug">{course.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">by {course.tutor.name}</p>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="size-3" /> {course.enrollmentCount} enrolled</span>
                {course.avgRating && (
                  <span className="flex items-center gap-1">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    {course.avgRating} ({course.reviewCount})
                  </span>
                )}
                <span>{new Date(course.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              disabled={updating}
              onClick={() => updateStatus({ id: course.id, status: nextStatus })}
            >
              {nextStatus === "PUBLISHED"
                ? <><Globe className="size-3.5 mr-1.5" /> Publish</>
                : <><Lock className="size-3.5 mr-1.5" /> Unpublish</>}
            </Button>
            {course.status !== "ARCHIVED" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={updating}
                onClick={() => updateStatus({ id: course.id, status: "ARCHIVED" })}
                className="text-muted-foreground"
              >
                <Archive className="size-3.5 mr-1.5" /> Archive
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── New course ───────────────────────────────────────────────────────────────

type TutorOption = { id: string; name: string; email: string }
type CategoryOption = { id: string; name: string }

/**
 * Creates the course shell — title, level, category and the tutor who runs it.
 * Sections, lessons and materials stay with that tutor; staff only set the
 * course up so students can be enrolled onto it.
 */
function NewCourseDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState<CourseLevel>("L1")
  const [categoryId, setCategoryId] = useState("")
  const [tutorId, setTutorId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tutorData } = useFetch<{ tutors: TutorOption[] }>("/api/tutor/colleagues", {
    errorMessage: false,
  })
  const { data: categoryData } = useFetch<{ categories: CategoryOption[] }>("/api/admin/categories", {
    errorMessage: false,
  })

  function reset() {
    setTitle(""); setDescription(""); setLevel("L1")
    setCategoryId(""); setTutorId(""); setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tutorId) { setError("Choose the tutor who will run this course"); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/tutor/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, level,
          categoryId: categoryId || undefined,
          tutorId,
        }),
      })
      if (!res.ok) {
        throw new Error((await res.json() as { message?: string }).message ?? "Could not create course")
      }
      setOpen(false)
      reset()
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create course")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-3.5" /> New Course
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New course</DialogTitle>
          <DialogDescription>
            Sets up the course so students can be enrolled. The tutor adds the lessons.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-title">Title</Label>
            <Input id="c-title" value={title} required
              onChange={(e) => setTitle(e.target.value)}
              placeholder="BSL Level 1 — Tuesday evenings" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-desc">Description</Label>
            <Textarea id="c-desc" value={description} required rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this course covers" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-level">Level</Label>
              <select
                id="c-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as CourseLevel)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {COURSE_LEVELS.map((l) => (
                  <option key={l} value={l}>{levelLabel[l]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-category">Category (optional)</Label>
              <select
                id="c-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No category</option>
                {(categoryData?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-tutor">Tutor running the course</Label>
            <select
              id="c-tutor"
              value={tutorId}
              required
              onChange={(e) => setTutorId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select a tutor…</option>
              {(tutorData?.tutors ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.email}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Create course
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
