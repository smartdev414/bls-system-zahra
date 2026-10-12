"use client"

import { useState } from "react"
import { CalendarClock, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { TIME_OPTIONS, timeOf } from "@/components/courses/time-options"

type SectionDates = { id: string; title: string; lessons: Array<{ releaseAt: string | null }> }

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

const DAY_MS = 24 * 60 * 60 * 1000

/** How many sections open together on each release date. */
const PER_STEP_OPTIONS = [1, 2, 3, 4, 5, 6]

function shortDate(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

/** The earliest release date among a section's lessons, if it has any. */
function sectionDate(section: SectionDates): Date | null {
  const times = section.lessons.flatMap((l) => (l.releaseAt ? [new Date(l.releaseAt).getTime()] : []))
  return times.length > 0 ? new Date(Math.min(...times)) : null
}

/** Next Monday — a sensible first guess for the start of a term. */
function nextMonday(): Date {
  const d = new Date()
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7))
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * When students get each section of a course: all at once, or a few sections
 * at a time from a start date — "Day 1–3 this week, Day 4–6 next week". One
 * date here replaces a date on every lesson.
 */
export function ReleaseScheduleDialog({
  courseId,
  sections,
  onClose,
  onSaved,
}: {
  courseId: string
  sections: SectionDates[]
  onClose: () => void
  onSaved: () => void
}) {
  // Start from the schedule the course already has, if any: the first date,
  // how many sections share it, and how far the next batch is from it.
  const firstDate = sections.length > 0 ? sectionDate(sections[0]) : null
  const firstBatch = firstDate
    ? Math.max(1, sections.findIndex((s) => sectionDate(s)?.getTime() !== firstDate.getTime()))
    : 1
  const nextDate = firstDate && firstBatch < sections.length ? sectionDate(sections[firstBatch]) : null
  const existingGap = firstDate && nextDate ? Math.round((nextDate.getTime() - firstDate.getTime()) / DAY_MS) : null

  // Opening this is nearly always to set a schedule, so that is the starting choice.
  const [staged, setStaged] = useState(true)
  const [date, setDate] = useState<Date | undefined>(firstDate ?? nextMonday())
  const [time, setTime] = useState(firstDate ? timeOf(firstDate) : "09:00")
  const [everyDays, setEveryDays] = useState(existingGap && [1, 7, 14].includes(existingGap) ? existingGap : 7)
  const [perStep, setPerStep] = useState(firstDate && firstBatch <= PER_STEP_OPTIONS.length ? firstBatch : 1)
  const [saving, setSaving] = useState(false)

  function opensOn(index: number): Date | null {
    if (!date) return null
    const [h, m] = time.split(":").map(Number)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Math.floor(index / perStep) * everyDays, h, m)
  }

  async function save() {
    const start = opensOn(0)
    if (staged && !start) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/release-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          staged
            ? {
                startAt: start!.toISOString(),
                everyDays,
                sectionsPerStep: perStep,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            : { startAt: null },
        ),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({})) as { message?: string }).message ?? "Could not save the schedule")
      }
      toast.success(
        staged
          ? `Release dates set for ${sections.length} section${sections.length === 1 ? "" : "s"}`
          : "Everything is now available straight away",
      )
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the schedule")
    } finally {
      setSaving(false)
    }
  }

  // Enough rows to show the first two batches, so the pattern is visible.
  const previewCount = Math.min(sections.length, Math.max(4, perStep * 2))
  const preview = sections.slice(0, previewCount)
  const last = sections.length > previewCount ? opensOn(sections.length - 1) : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" /> Release schedule
          </DialogTitle>
          <DialogDescription>
            When students get each section. Until then they see it as locked, with the date. Teachers can always see everything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {([[true, "One section at a time"], [false, "Everything straight away"]] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setStaged(value)}
                aria-pressed={staged === value}
                className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                  staged === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {staged ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>First section opens</Label>
                  <DatePicker value={date} onChange={setDate} placeholder="Pick a date" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-time">At</Label>
                  <select id="rs-time" value={time} onChange={(e) => setTime(e.target.value)} className={selectClass}>
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-per">Open at a time</Label>
                  <select
                    id="rs-per"
                    value={perStep}
                    onChange={(e) => setPerStep(parseInt(e.target.value))}
                    className={selectClass}
                  >
                    {PER_STEP_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n === 1 ? "1 section" : `${n} sections`}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-every">Then the next</Label>
                  <select
                    id="rs-every"
                    value={everyDays}
                    onChange={(e) => setEveryDays(parseInt(e.target.value))}
                    className={selectClass}
                  >
                    <option value={7}>Every week</option>
                    <option value={14}>Every 2 weeks</option>
                    <option value={1}>Every day</option>
                  </select>
                </div>
              </div>

              {date && sections.length > 0 && (
                <ul className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex flex-col gap-1" aria-label="Schedule preview">
                  {preview.map((s, i) => (
                    <li key={s.id} className="flex justify-between gap-3">
                      <span className="truncate">{s.title}</span>
                      <span className="text-muted-foreground shrink-0">{shortDate(opensOn(i)!)}</span>
                    </li>
                  ))}
                  {last && (
                    <li className="flex justify-between gap-3 text-muted-foreground">
                      <span>… {sections.length - previewCount} more, the last on</span>
                      <span className="shrink-0">{shortDate(last)}</span>
                    </li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
              Students see every lesson and test as soon as they are on the course. Any release dates already set are removed.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || (staged && !date)}>
            {saving && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
