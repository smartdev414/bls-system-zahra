"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  BookOpen, Plus, Users, Layers, FileText,
  Loader2, ChevronRight, Globe, Lock, Archive,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFetch, usePostCallback } from "@/hooks/use-fetch"
import { Pagination } from "@/components/ui/pagination"

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseItem = {
  id: string
  title: string
  slug: string
  description: string
  thumbnailUrl: string | null
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  category: { id: string; name: string } | null
  enrollmentCount: number
  sectionCount: number
  lessonCount: number
  createdAt: string
  updatedAt: string
}

type CoursesData = { courses: CourseItem[] }
type CourseBody = { title: string; description: string; level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusIcon = { PUBLISHED: Globe, DRAFT: Lock, ARCHIVED: Archive }
const statusColor: Record<string, string> = {
  PUBLISHED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  DRAFT: "bg-amber-100 text-amber-700 border-amber-200",
  ARCHIVED: "bg-muted text-muted-foreground",
}
const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-50 text-emerald-700",
  INTERMEDIATE: "bg-amber-50 text-amber-700",
  ADVANCED: "bg-rose-50 text-rose-700",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12

export default function TutorCoursesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, loading } = useFetch<CoursesData>("/api/tutor/courses", {
    errorMessage: "Could not load courses",
  })

  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState<CourseBody["level"]>("BEGINNER")

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setTitle("")
      setDescription("")
      setLevel("BEGINNER")
      setOpen(true)
      router.replace("/tutor/courses", { scroll: false })
    }
  }, [searchParams, router])

  const { execute: createCourse, loading: creating } = usePostCallback<{ course: { id: string } }, CourseBody>(
    "/api/tutor/courses",
    {
      successMessage: "Course created!",
      errorMessage: "Could not create course",
      onSuccess: (data) => {
        setOpen(false)
        router.push(`/tutor/courses/${data.course.id}`)
      },
    }
  )

  function openDialog() {
    setTitle("")
    setDescription("")
    setLevel("BEGINNER")
    setOpen(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createCourse({ title, description, level })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">My Courses</h1>
          <p className="text-muted-foreground mt-1">Manage your BSL courses and lessons.</p>
        </div>
        <Button onClick={openDialog}>
          <Plus className="size-4 mr-1.5" /> New Course
        </Button>
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
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${levelColor[course.level]}`}>
                        {course.level.charAt(0) + course.level.slice(1).toLowerCase()}
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
                        Manage Course <ChevronRight className="size-4 ml-1" />
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
                Create your first BSL course and start teaching.
              </p>
            </div>
            <Button onClick={openDialog}>
              <Plus className="size-4 mr-1.5" /> Create First Course
            </Button>
          </CardContent>
        </Card>
      )}

      {/* New Course Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" /> Create New Course
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Course Title <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                placeholder="e.g. BSL Beginner Basics"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="description"
                placeholder="Describe what students will learn in this course..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="level">Level <span className="text-destructive">*</span></Label>
              <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
                <SelectTrigger id="level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BEGINNER">Beginner</SelectItem>
                  <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                  <SelectItem value="ADVANCED">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={creating || !title.trim() || !description.trim()}>
                {creating ? "Creating..." : "Create Course"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
