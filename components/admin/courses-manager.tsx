"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BookOpen, Search, Loader2, Globe, Lock, Archive,
  Star, Users, Filter, Plus, Pencil, GraduationCap, Copy,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useFetch, usePatchCallback, usePutCallback } from "@/hooks/use-fetch"
import { TutorPickerModal } from "@/components/classroom/TutorPickerModal"
import { CopyCourseDialog } from "@/components/courses/CopyCourseDialog"
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
  // Teachers the school has put on the course, besides its lead.
  teachers: Array<{ id: string; name: string }>
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

/**
 * `builderBase` — where the course builder lives for this portal. Set for
 * admins (who can edit lesson content); left out for support staff, who only
 * set courses up and publish them.
 */
export function CoursesManager({
  canCreate = true,
  builderBase,
}: { canCreate?: boolean; builderBase?: string } = {}) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [teachersFor, setTeachersFor] = useState<CourseItem | null>(null)
  // Copying brings the lessons with it, so it is offered where the builder is (admins).
  const [copyOf, setCopyOf] = useState<CourseItem | null>(null)
  const router = useRouter()

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
        {canCreate && <NewCourseDialog onCreated={refetch} builderBase={builderBase} />}
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
            <CourseRow
              key={course.id}
              course={course}
              onMutated={refetch}
              onEditTeachers={() => setTeachersFor(course)}
              onCopy={builderBase ? () => setCopyOf(course) : undefined}
              builderBase={builderBase}
            />
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

      {copyOf && builderBase && (
        <CopyCourseDialog
          key={copyOf.id}
          course={copyOf}
          onClose={() => setCopyOf(null)}
          onCopied={(newId) => { setCopyOf(null); router.push(`${builderBase}/${newId}`) }}
        />
      )}

      {teachersFor && (
        <CourseTeachersModal
          key={teachersFor.id}
          course={teachersFor}
          onClose={() => setTeachersFor(null)}
          onSaved={refetch}
        />
      )}
    </div>
  )
}

// ─── Course row ───────────────────────────────────────────────────────────────

function CourseRow({ course, onMutated, onEditTeachers, onCopy, builderBase }: {
  course: CourseItem
  onMutated: () => void
  onEditTeachers: () => void
  /** Offered to admins only: makes the course again for another group. */
  onCopy?: () => void
  builderBase?: string
}) {
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
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <GraduationCap className="size-3 shrink-0" />
                {course.teachers.length > 0
                  ? <span className="truncate">Teachers: {course.teachers.map((t) => t.name).join(", ")}</span>
                  : <span>No teachers added yet</span>}
              </p>
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

          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={onEditTeachers}>
              <GraduationCap className="size-3.5 mr-1.5" /> Teachers
            </Button>
            {builderBase && (
              <Button asChild variant="outline" size="sm">
                <Link href={`${builderBase}/${course.id}`}>
                  <Pencil className="size-3.5 mr-1.5" /> Manage
                </Link>
              </Button>
            )}
            {onCopy && (
              <Button variant="outline" size="sm" onClick={onCopy} aria-label={`Copy ${course.title}`}>
                <Copy className="size-3.5 mr-1.5" /> Copy
              </Button>
            )}
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

// ─── Teachers on a course ─────────────────────────────────────────────────────

/**
 * Puts teachers on a course. Rendered by the list rather than the row, so a
 * list reload (search, filter, another save) cannot close it mid-selection.
 */
function CourseTeachersModal({
  course,
  onClose,
  onSaved,
}: {
  course: CourseItem
  onClose: () => void
  onSaved: () => void
}) {
  const { execute: saveTeachers, loading: saving } = usePutCallback<
    { teachers: Array<{ id: string; name: string }> },
    { tutorIds: string[] }
  >(`/api/admin/courses/${course.id}/tutors`, {
    successMessage: (d) =>
      d.teachers.length === 0
        ? "No extra teachers on this course"
        : `${d.teachers.length} teacher${d.teachers.length === 1 ? "" : "s"} on this course`,
    errorMessage: "Could not update teachers",
    onSuccess: () => { onClose(); onSaved() },
  })

  return (
    <TutorPickerModal
      selected={new Set(course.teachers.map((t) => t.id))}
      excludeIds={new Set([course.tutor.id])}
      title={`Teachers on “${course.title}”`}
      description="Teachers can open this course, follow its lessons, see its students and schedule classes. They cannot change the lessons."
      confirmLabel="Save Teachers"
      confirming={saving}
      onConfirm={(ids) => saveTeachers({ tutorIds: [...ids] })}
      onClose={() => { if (!saving) onClose() }}
    />
  )
}

// ─── New course ───────────────────────────────────────────────────────────────

type TutorOption = { id: string; name: string; email: string }
type CategoryOption = { id: string; name: string }

/**
 * Creates the course shell — title, level, category and, optionally, the tutor
 * who runs it (without one, the course belongs to whoever created it).
 * With a `builderBase` (admins) it then opens the builder so sections and
 * lessons can be added straight away; otherwise the tutor adds them.
 */
function NewCourseDialog({ onCreated, builderBase }: { onCreated: () => void; builderBase?: string }) {
  const router = useRouter()
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
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/tutor/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, level,
          categoryId: categoryId || undefined,
          tutorId: tutorId || undefined,
        }),
      })
      if (!res.ok) {
        throw new Error((await res.json() as { message?: string }).message ?? "Could not create course")
      }
      const { course } = await res.json() as { course: { id: string } }
      setOpen(false)
      reset()
      if (builderBase) router.push(`${builderBase}/${course.id}`)
      else onCreated()
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
            {builderBase
              ? "Sets up the course, then opens the builder so you can add sections and lessons."
              : "Sets up the course so students can be enrolled. An admin adds the lessons."}
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
            <Label htmlFor="c-tutor">Lead teacher (optional)</Label>
            <select
              id="c-tutor"
              value={tutorId}
              onChange={(e) => setTutorId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">No tutor yet</option>
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
