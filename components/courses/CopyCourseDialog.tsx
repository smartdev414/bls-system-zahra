"use client"

import { useState } from "react"
import { Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useFetch } from "@/hooks/use-fetch"

type Summary = {
  title: string
  sections: number
  lessons: number
  tests: number
  files: number
  // Lessons and tests that have a release date — the ones a new start date moves.
  scheduled: number
  firstReleaseAt: string | null
  lastReleaseAt: string | null
}

type Group = { id: string; name: string; tutorName?: string; members: Array<{ id: string }> }

type TutorOption = { id: string; name: string; email: string }

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole calendar days from `from` to `to`, as the person at this screen sees the dates. */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY_MS,
  )
}

function longDate(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/**
 * Copy a course for another group: the same lessons, files and tests, with the
 * release dates moved to the new group's start. One short form instead of
 * building the course again — name it, say when it starts, and (optionally)
 * which group it is for.
 */
export function CopyCourseDialog({
  course,
  onClose,
  onCopied,
}: {
  course: { id: string; title: string }
  onClose: () => void
  /** Called with the new course's id once the copy exists. */
  onCopied: (courseId: string) => void
}) {
  const { data: summary, loading } = useFetch<Summary>(`/api/admin/courses/${course.id}/copy`, {
    errorMessage: "Could not load the course",
  })
  const { data: groupData } = useFetch<{ groups: Group[] }>("/api/tutor/groups", { errorMessage: false })
  const { data: tutorData } = useFetch<{ tutors: TutorOption[] }>("/api/tutor/colleagues", { errorMessage: false })

  // Left untouched, the name follows the group that is picked.
  const [name, setName] = useState<string | null>(null)
  const [groupId, setGroupId] = useState("")
  // Empty = no tutor yet: the copy stays with whoever made it, as a new course does.
  const [tutorId, setTutorId] = useState("")
  // The date the copy's first scheduled lesson should release. Unset = same dates.
  const [start, setStart] = useState<Date | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = groupData?.groups ?? []
  const group = groups.find((g) => g.id === groupId)
  // "BSL Level 1 – Group A" copied for Group B should suggest "BSL Level 1 –
  // Group B", not stack a second suffix on the first.
  const baseTitle = course.title.replace(/\s*\(copy\)\s*$/i, "").replace(/\s+[–—-]\s+[^–—-]+$/, "")
  const title = name ?? (group ? `${baseTitle} – ${group.name}` : `${course.title} (copy)`)

  const first = summary?.firstReleaseAt ? new Date(summary.firstReleaseAt) : null
  const last = summary?.lastReleaseAt ? new Date(summary.lastReleaseAt) : null
  const shiftDays = first && start ? calendarDaysBetween(first, start) : 0
  const newLast = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + shiftDays) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/courses/${course.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          shiftDays,
          // So 09:00 stays 09:00 on the wall, even across a clock change.
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(groupId ? { groupId } : {}),
          ...(tutorId ? { tutorId } : {}),
        }),
      })
      const body = await res.json().catch(() => ({})) as {
        course?: { id: string; title: string }
        group?: { name: string; enrolled: number } | null
        message?: string
      }
      if (!res.ok || !body.course) throw new Error(body.message ?? "Could not copy the course")
      toast.success(
        `"${body.course.title}" created` +
        (body.group ? ` with ${body.group.name} (${plural(body.group.enrolled, "student")})` : ""),
      )
      onCopied(body.course.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy the course")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-4 text-primary" /> Copy course
          </DialogTitle>
          <DialogDescription>
            Make this course again for another group, with its own dates. Nothing needs uploading twice.
          </DialogDescription>
        </DialogHeader>

        {loading && !summary ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : summary ? (
          <form id="copy-course-form" onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm rounded-lg border bg-muted/30 px-3 py-2">
              <span className="font-medium">Copies:</span>{" "}
              {[
                plural(summary.sections, "section"),
                plural(summary.lessons, "lesson"),
                plural(summary.tests, "test"),
                plural(summary.files, "file"),
              ].join(", ")}.
              <span className="block text-xs text-muted-foreground mt-0.5">
                Students, classes and teachers are not copied — pick the new group and its teacher below.
              </span>
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-group">Group for this copy <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <select id="cc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={selectClass}>
                <option value="">Choose later</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — {plural(g.members.length, "student")}{g.tutorName ? ` (${g.tutorName})` : ""}
                  </option>
                ))}
              </select>
              {group && (
                <p className="text-xs text-muted-foreground">
                  Its {plural(group.members.length, "student")} will be put on the new course.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-tutor">Lead teacher <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <select id="cc-tutor" value={tutorId} onChange={(e) => setTutorId(e.target.value)} className={selectClass}>
                <option value="">No tutor yet</option>
                {(tutorData?.tutors ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {t.email}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-name">Name of the copy</Label>
              <Input id="cc-name" value={title} onChange={(e) => setName(e.target.value)} required />
            </div>

            {first ? (
              <div className="flex flex-col gap-1.5">
                <Label>First release date</Label>
                <DatePicker value={start ?? first} onChange={setStart} placeholder="Pick a date" />
                <p className="text-xs text-muted-foreground">
                  {shiftDays === 0 ? (
                    <>
                      The original&apos;s first scheduled lesson releases on {longDate(first)}. Pick the date it
                      should release for this group — the other {summary.scheduled > 1 ? `${summary.scheduled - 1} scheduled lessons and tests` : "dates"} move
                      with it.
                    </>
                  ) : (
                    <>
                      All {plural(summary.scheduled, "release date")} move {Math.abs(shiftDays) % 7 === 0
                        ? plural(Math.abs(shiftDays) / 7, "week")
                        : plural(Math.abs(shiftDays), "day")} {shiftDays > 0 ? "later" : "earlier"}, keeping the
                      same time of day.{newLast ? ` The last one becomes ${longDate(newLast)}.` : ""}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                This course has no release dates set, so everything in the copy is available to its students straight away.
              </p>
            )}

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground py-4">This course could not be loaded.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="copy-course-form" disabled={!summary || !title.trim() || saving}>
            {saving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Copy className="size-3.5 mr-1.5" />}
            Copy course
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
