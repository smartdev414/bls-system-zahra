"use client"

import { useState } from "react"
import { CalendarPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { TIME_OPTIONS } from "@/components/courses/time-options"

/** "Everyone on the course" rather than one group. */
export const WHOLE_COURSE = "all"

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

const DURATIONS = [30, 45, 60, 90, 120]

function durationLabel(mins: number) {
  if (mins < 60) return `${mins} minutes`
  if (mins % 60 === 0) return mins === 60 ? "1 hour" : `${mins / 60} hours`
  return `${Math.floor(mins / 60)} h ${mins % 60} min`
}

/** What the form starts with — taken from the classes already on the course. */
export type ClassDefaults = {
  date?: Date
  time?: string
  durationMins?: number
  tutorId?: string
}

/**
 * Schedule a class for one group on a course (or for everyone on it).
 *
 * Kept to the one thing that has to be decided — when. Everything else starts
 * filled in from the group's previous class (same time, same length, same
 * teacher, a week later), and the class is named after the course and group.
 * Files and co-teachers stay on the Live Sessions page for classes that need them.
 */
export function ScheduleClassDialog({
  courseId,
  courseTitle,
  groups,
  initialTarget,
  defaults = {},
  mustAssignTutor,
  tutorOptions,
  onClose,
  onScheduled,
}: {
  courseId: string
  courseTitle: string
  groups: Array<{ id: string; name: string }>
  /** A group id, or `WHOLE_COURSE`. */
  initialTarget: string
  defaults?: ClassDefaults
  /** Staff do not teach, so they choose the tutor who takes the class. */
  mustAssignTutor: boolean
  tutorOptions: Array<{ id: string; name: string }>
  onClose: () => void
  onScheduled: () => void
}) {
  const [target, setTarget] = useState(initialTarget)
  const [date, setDate] = useState<Date | undefined>(defaults.date)
  const [time, setTime] = useState(defaults.time ?? "")
  const [durationMins, setDurationMins] = useState(defaults.durationMins ?? 60)
  const [repeatWeekly, setRepeatWeekly] = useState(true)
  const [weeks, setWeeks] = useState(10)
  const [tutorId, setTutorId] = useState(
    tutorOptions.some((t) => t.id === defaults.tutorId)
      ? defaults.tutorId!
      : tutorOptions.length === 1 ? tutorOptions[0].id : "",
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const group = groups.find((g) => g.id === target)
  const occurrences = repeatWeekly ? Math.min(Math.max(weeks || 2, 2), 52) : 1
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ready = !!date && !!time && (!mustAssignTutor || !!tutorId)
  const durations = DURATIONS.includes(durationMins) ? DURATIONS : [...DURATIONS, durationMins].sort((a, b) => a - b)

  function startsAt(): Date | null {
    if (!date || !time) return null
    const [hours, minutes] = time.split(":").map(Number)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes)
  }

  // "10 classes · Mondays 18:00–19:00 · 5 Oct to 7 Dec" — what pressing the button creates.
  function summary(): string | null {
    const start = startsAt()
    if (!start) return null
    const end = new Date(start.getTime() + durationMins * 60_000)
    const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    if (occurrences === 1) {
      return `1 class · ${start.toLocaleDateString("en-GB", { weekday: "long" })} ${day(start)}, ${clock(start)}–${clock(end)}`
    }
    const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (occurrences - 1) * 7)
    return `${occurrences} classes · ${start.toLocaleDateString("en-GB", { weekday: "long" })}s ${clock(start)}–${clock(end)} · ${day(start)} to ${day(last)}`
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const scheduledAt = startsAt()
    if (!scheduledAt) return

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/tutor/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: group ? `${courseTitle} — ${group.name}` : courseTitle,
          scheduledAt: scheduledAt.toISOString(),
          durationMins,
          courseId,
          // One group's class is invite-only for that group; a whole-course
          // class is open to everyone enrolled.
          ...(group ? { groupId: group.id } : { visibility: "PUBLIC" }),
          repeatWeeks: occurrences,
          ...(mustAssignTutor ? { tutorId } : {}),
        }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({})) as { message?: string }).message ?? "Could not schedule the class")
      }
      toast.success(occurrences > 1 ? `${occurrences} weekly classes scheduled` : "Class scheduled")
      onScheduled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule the class")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4 text-primary" /> Schedule class
          </DialogTitle>
          <DialogDescription>
            {group
              ? `Only the students in ${group.name} are invited and see this class.`
              : "Everyone on the course can join this class."}
          </DialogDescription>
        </DialogHeader>

        <form id="schedule-class-form" onSubmit={submit} className="flex flex-col gap-4">
          {/* Only a question when there is more than one answer. */}
          {groups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sc-target">Class for</Label>
              <select id="sc-target" value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value={WHOLE_COURSE}>Everyone on the course</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_8rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{repeatWeekly ? "First class" : "Date"}</Label>
              <DatePicker value={date} onChange={setDate} placeholder="Pick a date" disabled={(d) => d < today} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sc-time">Starts</Label>
              <select id="sc-time" value={time} onChange={(e) => setTime(e.target.value)} className={selectClass} required>
                <option value="" disabled>Time</option>
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sc-duration">Length</Label>
              <select
                id="sc-duration"
                value={durationMins}
                onChange={(e) => setDurationMins(parseInt(e.target.value))}
                className={selectClass}
              >
                {durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={repeatWeekly} onCheckedChange={(v) => setRepeatWeekly(v === true)} />
              <span className="text-sm font-medium">Repeat every week</span>
            </label>
            {repeatWeekly && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                for
                <Input
                  id="sc-weeks"
                  type="number"
                  min={2}
                  max={52}
                  value={weeks}
                  onChange={(e) => setWeeks(parseInt(e.target.value) || 2)}
                  className="h-8 w-16 text-sm"
                  aria-label="Number of weeks"
                />
                weeks
              </span>
            )}
          </div>

          {mustAssignTutor && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sc-tutor">Teacher taking the class</Label>
              <select id="sc-tutor" value={tutorId} onChange={(e) => setTutorId(e.target.value)} required className={selectClass}>
                <option value="">Select a teacher…</option>
                {tutorOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {summary() && (
            <p className="text-sm rounded-lg border bg-muted/30 px-3 py-2" aria-label="What will be scheduled">
              {summary()}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="schedule-class-form" disabled={!ready || saving}>
            {saving && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            {occurrences > 1 ? `Schedule ${occurrences} classes` : "Schedule class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
