"use client"

import { useState } from "react"
import {
  BookOpen, Search, Loader2, Globe, Lock, Archive,
  Star, Users, Filter,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseItem = {
  id: string
  title: string
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
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

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-50 text-emerald-700",
  INTERMEDIATE: "bg-amber-50 text-amber-700",
  ADVANCED: "bg-rose-50 text-rose-700",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminCoursesPage() {
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
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <BookOpen className="size-6 text-primary" /> Courses
        </h1>
        <p className="text-muted-foreground mt-1">
          {loading ? "\u00A0" : `${data?.total ?? 0} course${data?.total !== 1 ? "s" : ""} on the platform`}
        </p>
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
                <Badge variant="outline" className={`text-[10px] ${levelColor[course.level]}`}>
                  {course.level.charAt(0) + course.level.slice(1).toLowerCase()}
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
