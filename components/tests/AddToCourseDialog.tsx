"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ReleaseField, releaseToIso } from "@/components/courses/ReleaseField"
import { useFetch } from "@/hooks/use-fetch"
import { levelLabel, type CourseLevel } from "@/lib/levels"

type CourseOption = {
  id: string
  title: string
  level: CourseLevel
  status: string
  sections: Array<{ id: string; title: string }>
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

/**
 * Put a bank test in a course: choose the course and the section it goes at
 * the end of, and when students get it. The same test can go in any number of
 * courses — one per level, say.
 */
export function AddToCourseDialog({ test, open, onOpenChange, onAdded }: {
  test: { id: string; title: string; level?: CourseLevel | null }
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body test={test} onOpenChange={onOpenChange} onAdded={onAdded} />}
    </Dialog>
  )
}

function Body({ test, onOpenChange, onAdded }: {
  test: { id: string; title: string; level?: CourseLevel | null }
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}) {
  const { data, loading } = useFetch<{ courses: CourseOption[] }>("/api/tests/course-options", {
    errorMessage: "Could not load your courses",
  })
  const [courseId, setCourseId] = useState("")
  const [sectionId, setSectionId] = useState("")
  const [releaseAt, setReleaseAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const courses = data?.courses ?? []
  // The test's own level first, so the likely course is near the top.
  const sorted = test.level
    ? [...courses.filter((c) => c.level === test.level), ...courses.filter((c) => c.level !== test.level)]
    : courses
  const course = courses.find((c) => c.id === courseId)

  function chooseCourse(id: string) {
    setCourseId(id)
    const sections = courses.find((c) => c.id === id)?.sections ?? []
    // The last section is where a new test usually goes.
    setSectionId(sections.length > 0 ? sections[sections.length - 1].id : "")
  }

  async function add() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tests/${test.id}/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, sectionId, releaseAt: releaseToIso(releaseAt) }),
      })
      const d = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(d.message ?? "Could not add the test")
      toast.success(`Added to ${course?.title ?? "the course"}`)
      onAdded?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the test")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add to a course</DialogTitle>
        <DialogDescription>
          <span className="font-medium">{test.title}</span> goes at the end of the section you choose. Changes you make to the test later reach every course it is in.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-course">Course</Label>
          {loading && !data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading courses…</p>
          ) : courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">You are not teaching any courses yet.</p>
          ) : (
            <select id="test-course" value={courseId} onChange={(e) => chooseCourse(e.target.value)} className={selectClass}>
              <option value="">Choose a course</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {levelLabel[c.level]} · {c.title}{c.status === "DRAFT" ? " (draft)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {course && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-section">Section</Label>
            {course.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">This course has no sections yet. Add one on the course page first.</p>
            ) : (
              <select id="test-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectClass}>
                {course.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )}
          </div>
        )}

        {course && course.sections.length > 0 && <ReleaseField value={releaseAt} onChange={setReleaseAt} />}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={add} disabled={!courseId || !sectionId || saving}>
          {saving ? "Adding…" : "Add to course"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
