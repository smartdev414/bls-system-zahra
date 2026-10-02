"use client"

import { useState } from "react"
import { CalendarPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

/** "Everyone on the course" rather than one group. */
export const WHOLE_COURSE = "all"

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

const DURATIONS = [30, 45, 60, 90, 120]

/**
 * Schedule a class for one group on a course (or for everyone on it).
 *
 * Deliberately short: who the class is for, when, how long, and whether it
 * repeats every week. Files, co-teachers and the rest stay on the Live
 * Sessions page for the few classes that need them.
 */
export function ScheduleClassDialog({
  courseId,
  courseTitle,
  groups,
  initialTarget,
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
  /** Staff do not teach, so they choose the tutor who takes the class. */
  mustAssignTutor: boolean
  tutorOptions: Array<{ id: string; name: string }>
  onClose: () => void
  onScheduled: () => void
}) {
  const [target, setTarget] = useState(initialTarget)
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [time, setTime] = useState("")
  const [durationMins, setDurationMins] = useState(60)
  const [repeatWeekly, setRepeatWeekly] = useState(true)
  const [weeks, setWeeks] = useState(10)
  const [tutorId, setTutorId] = useState(tutorOptions.length === 1 ? tutorOptions[0].id : "")
  // Left empty, the class is named after the course and group.
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const group = groups.find((g) => g.id === target)
  const defaultTitle = group ? `${courseTitle} — ${group.name}` : courseTitle
  const occurrences = repeatWeekly ? Math.min(Math.max(weeks || 2, 2), 52) : 1
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ready = !!date && !!time && (!mustAssignTutor || !!tutorId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) return
    const [hours, minutes] = time.split(":")
    const scheduledAt = new Date(date)
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/tutor/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || defaultTitle,
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-target">Class for</Label>
            <select id="sc-target" value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value={WHOLE_COURSE}>Everyone on the course</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{repeatWeekly ? "First class" : "Date"}</Label>
              <DatePicker value={date} onChange={setDate} placeholder="Pick a date" disabled={(d) => d < today} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Start time</Label>
              <TimePicker value={time} onChange={setTime} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-duration">Length</Label>
            <select
              id="sc-duration"
              value={durationMins}
              onChange={(e) => setDurationMins(parseInt(e.target.value))}
              className={selectClass}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>{d < 60 ? `${d} minutes` : d === 60 ? "1 hour" : `${d / 60} hours`}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 px-3 py-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={repeatWeekly} onCheckedChange={(v) => setRepeatWeekly(v === true)} />
              <span className="text-sm font-medium">Repeat every week</span>
              <span className="text-xs text-muted-foreground">same day and time</span>
            </label>
            {repeatWeekly && (
              <div className="flex items-center gap-2 pl-6">
                <Label htmlFor="sc-weeks" className="text-xs text-muted-foreground">for</Label>
                <Input
                  id="sc-weeks"
                  type="number"
                  min={2}
                  max={52}
                  value={weeks}
                  onChange={(e) => setWeeks(parseInt(e.target.value) || 2)}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">weeks</span>
              </div>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-title">Class name <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="sc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} />
          </div>

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
