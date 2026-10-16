"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TestKindPicker } from "@/components/quiz/TestKindFields"
import { useCoursesBase } from "@/hooks/use-courses-base"
import { useTestsBase } from "@/hooks/use-tests-base"
import { COURSE_LEVELS, levelLabel, type CourseLevel } from "@/lib/levels"
import type { TestKind } from "@/lib/quiz"

// A new test: just its name, kind and level. The questions are added on the
// next screen, where everything saves as it goes. Opened from a course's
// "Add Lesson", it is put in that course's section as soon as it is made.
export default function NewTestPage() {
  const router = useRouter()
  const testsBase = useTestsBase()
  const coursesBase = useCoursesBase()
  const searchParams = useSearchParams()
  const courseId = searchParams.get("courseId")
  const sectionId = searchParams.get("sectionId")

  const [title, setTitle] = useState("")
  const [kind, setKind] = useState<TestKind>("STANDARD")
  const [level, setLevel] = useState<CourseLevel | "">("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backHref = courseId ? `${coursesBase}/${courseId}` : testsBase

  async function create() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), testKind: kind, level: level || null }),
      })
      const d = await res.json().catch(() => ({})) as { test?: { id: string }; message?: string }
      if (!res.ok || !d.test) throw new Error(d.message ?? "Could not create the test")

      if (courseId && sectionId) {
        const placed = await fetch(`/api/tests/${d.test.id}/courses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId, sectionId }),
        })
        if (placed.ok) toast.success("Test made and added to the course. Now add its questions.")
        else toast.error("The test was made, but could not be added to the course. Use “Add to course” on the next screen.")
      }
      router.replace(`${testsBase}/${d.test.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the test")
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={backHref}>
          <ChevronLeft className="size-4 mr-1" /> {courseId ? "Back to Course" : "Back to Tests"}
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-black tracking-tight">New test</h1>
        <p className="text-muted-foreground mt-1">Name it and choose its kind. You add the questions next.</p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => { e.preventDefault(); void create() }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-title">Title</Label>
          <Input
            id="test-title"
            className="h-11"
            placeholder="e.g. Colours — end of unit test"
            value={title}
            autoFocus
            maxLength={150}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <TestKindPicker value={kind} onChange={setKind} />

        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="test-level">Level <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <select
            id="test-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as CourseLevel | "")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Any level</option>
            {COURSE_LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Helps find the test later. It can still go in a course of any level.</p>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <Button type="submit" className="self-start" disabled={!title.trim() || saving}>
          {saving ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Creating…</> : "Create and add questions"}
        </Button>
      </form>
    </div>
  )
}
