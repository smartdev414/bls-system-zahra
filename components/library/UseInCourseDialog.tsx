"use client"

/**
 * "Add to a lesson" from the library: choose the course and section, then go
 * to the new-lesson page with the file already attached. (Tests are made in
 * the Tests menu, whose builder picks from the library too.)
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useCoursesBase } from "@/hooks/use-courses-base"
import type { LibraryItem } from "@/lib/library"

type CourseRow = { id: string; title: string; sectionCount: number }
type SectionRow = { id: string; title: string }

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

type Props = {
  /** The file to use; the dialog is open while this is set. */
  file: LibraryItem | null
  onClose: () => void
}

export function UseInCourseDialog({ file, onClose }: Props) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      {file && <Body file={file} onClose={onClose} />}
    </Dialog>
  )
}

function Body({ file, onClose }: { file: LibraryItem; onClose: () => void }) {
  const router = useRouter()
  const coursesBase = useCoursesBase()
  const [courses, setCourses] = useState<CourseRow[] | null>(null)
  const [courseId, setCourseId] = useState("")
  const [sections, setSections] = useState<SectionRow[] | null>(null)
  const [sectionId, setSectionId] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/tutor/courses")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { courses: CourseRow[] }) => { if (!cancelled) setCourses(d.courses) })
      .catch(() => { if (!cancelled) setError("Could not load your courses") })
    return () => { cancelled = true }
  }, [])

  function chooseCourse(id: string) {
    setCourseId(id)
    setSections(null)
    setSectionId("")
  }

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    fetch(`/api/tutor/courses/${courseId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { course: { sections: SectionRow[] } }) => {
        if (cancelled) return
        setSections(d.course.sections)
        if (d.course.sections.length === 1) setSectionId(d.course.sections[0].id)
      })
      .catch(() => { if (!cancelled) setError("Could not load the course's sections") })
    return () => { cancelled = true }
  }, [courseId])

  function go() {
    const params = new URLSearchParams({ sectionId, file: file.id, kind: "VIDEO" })
    router.push(`${coursesBase}/${courseId}/lessons/new?${params}`)
    onClose()
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add to a lesson</DialogTitle>
        <DialogDescription>
          A new lesson with <span className="font-medium">{file.title}</span> attached. Choose where it goes.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="use-course">Course</Label>
          {courses === null && !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading courses…</p>
          ) : (
            <select id="use-course" value={courseId} onChange={(e) => chooseCourse(e.target.value)} className={selectClass}>
              <option value="">Choose a course</option>
              {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>
        {courseId && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="use-section">Section</Label>
            {sections === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading sections…</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">This course has no sections yet. Add one on the course page first.</p>
            ) : (
              <select id="use-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectClass}>
                <option value="">Choose a section</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={!courseId || !sectionId}>Continue</Button>
      </DialogFooter>
    </DialogContent>
  )
}
