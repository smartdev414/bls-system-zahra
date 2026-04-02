"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BookOpen, Search, Star, Users, Layers, CheckCircle2,
  Loader2, Filter, ArrowRight, LogOut,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useFetch, usePostCallback, useDeleteCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type Course = {
  id: string
  title: string
  description: string
  thumbnailUrl: string | null
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  tutor: { id: string; name: string }
  category: { id: string; name: string } | null
  enrollmentCount: number
  sectionCount: number
  lessonCount: number
  avgRating: number | null
  reviewCount: number
  isEnrolled: boolean
}

type CoursesData = { courses: Course[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const levelColor: Record<string, string> = {
  BEGINNER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  INTERMEDIATE: "bg-amber-100 text-amber-700 border-amber-200",
  ADVANCED: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentCoursesPage() {
  const [query, setQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState("all")

  const { data, loading, refetch } = useFetch<CoursesData>("/api/student/courses", {
    errorMessage: "Could not load courses",
  })

  const filtered = (data?.courses ?? []).filter((c) => {
    const matchQ = !query ||
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.tutor.name.toLowerCase().includes(query.toLowerCase())
    const matchLevel = levelFilter === "all" || c.level === levelFilter
    return matchQ && matchLevel
  })

  const enrolled = filtered.filter((c) => c.isEnrolled)
  const available = filtered.filter((c) => !c.isEnrolled)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <BookOpen className="size-6 text-primary" /> Courses
        </h1>
        <p className="text-muted-foreground mt-1">Browse and enrol in BSL courses.</p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search courses or tutors..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-40">
            <Filter className="size-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="BEGINNER">Beginner</SelectItem>
            <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
            <SelectItem value="ADVANCED">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {enrolled.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-500" /> My Enrolled Courses
              </h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {enrolled.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            </section>
          )}

          <section>
            {enrolled.length > 0 && available.length > 0 && (
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <BookOpen className="size-3.5" /> Available Courses
              </h2>
            )}
            {available.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((c) => <CourseCard key={c.id} course={c} onMutated={refetch} />)}
              </div>
            ) : !enrolled.length ? (
              <Card className="shadow-sm">
                <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
                  <div className="rounded-full bg-muted p-6">
                    <BookOpen className="size-10 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">No courses found</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {query || levelFilter !== "all" ? "Try adjusting your filters." : "No published courses yet."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}

// ─── Course card — owns enrol + review hooks ──────────────────────────────────

function CourseCard({ course, onMutated }: { course: Course; onMutated: () => void }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")

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
      <Card className="shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
        {/* Thumbnail */}
        <div className="aspect-video bg-primary/10 flex items-center justify-center relative overflow-hidden shrink-0">
          {course.thumbnailUrl ? (
            <img src={course.thumbnailUrl} alt={course.title} className="w-full h-full object-cover" />
          ) : (
            <BookOpen className="size-10 text-primary/40" />
          )}
          <div className="absolute top-2 left-2">
            <Badge variant="outline" className={`text-[10px] ${levelColor[course.level]}`}>
              {course.level.charAt(0) + course.level.slice(1).toLowerCase()}
            </Badge>
          </div>
          {course.isEnrolled && (
            <div className="absolute top-2 right-2">
              <Badge className="bg-emerald-500 text-white text-[10px]">Enrolled</Badge>
            </div>
          )}
        </div>

        <CardHeader className="pb-2 flex-1">
          <CardTitle className="text-base leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {course.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">by {course.tutor.name}</p>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{course.description}</p>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><Layers className="size-3" /> {course.sectionCount} sections</span>
            <span className="flex items-center gap-1"><BookOpen className="size-3" /> {course.lessonCount} lessons</span>
            <span className="flex items-center gap-1"><Users className="size-3" /> {course.enrollmentCount}</span>
          </div>
          {course.avgRating && (
            <div className="flex items-center gap-1 text-xs">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{course.avgRating}</span>
              <span className="text-muted-foreground">({course.reviewCount})</span>
            </div>
          )}

          {course.isEnrolled ? (
            <div className="flex gap-2">
              <Button asChild size="sm" className="flex-1">
                <Link href="/student/lessons">
                  Continue <ArrowRight className="size-4 ml-1" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)} title="Rate course">
                <Star className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={unenrolling}
                onClick={() => unenroll()}
                title="Unenrol"
                className="text-muted-foreground hover:text-destructive"
              >
                {unenrolling ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              </Button>
            </div>
          ) : (
            <Button size="sm" className="w-full" onClick={() => enroll({})} disabled={enrolling}>
              {enrolling && <Loader2 className="size-4 animate-spin mr-1.5" />}
              {enrolling ? "Enrolling..." : "Enrol Free"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Review dialog */}
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
