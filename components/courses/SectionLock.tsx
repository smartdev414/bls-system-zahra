"use client"

import { useState } from "react"
import { CalendarClock, Loader2, Lock, LockOpen } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TIME_OPTIONS, timeOf } from "@/components/courses/time-options"
import { usePatchCallback } from "@/hooks/use-fetch"
import { releaseLabel } from "@/lib/lesson-release"

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"

/** Next Monday 09:00 — the usual "next week". */
function nextMondayMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7))
  d.setHours(9, 0, 0, 0)
  return d
}

/**
 * The padlock on a section header: sets the date the section opens to students
 * (next Monday 09:00 unless changed); on a locked section the same button
 * offers "Open now". Students see a locked section with its opening date.
 */
export function SectionLock({
  courseId,
  sectionId,
  releaseAt,
  hasLessons,
  onSaved,
  onOpenSchedule,
}: {
  courseId: string
  sectionId: string
  /** The date the section is locked until, or null when it is open. */
  releaseAt: string | null
  hasLessons: boolean
  onSaved: () => void
  /** Opens the course-wide release schedule, for dating every section at once. */
  onOpenSchedule?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<Date | undefined>()
  const [time, setTime] = useState("09:00")

  const locked = !!releaseAt && new Date(releaseAt) > new Date()

  const { execute: save, loading } = usePatchCallback<{ ok: true }, { releaseAt: string | null }>(
    `/api/tutor/courses/${courseId}/sections/${sectionId}`,
    {
      successMessage: false,
      errorMessage: "Could not change the lock",
      onSuccess: (_, body) => {
        toast.success(body.releaseAt ? `Opens ${releaseLabel(body.releaseAt)}` : "Section open now")
        setOpen(false)
        onSaved()
      },
    },
  )

  function onOpenChange(next: boolean) {
    if (next) {
      const start = locked ? new Date(releaseAt!) : nextMondayMorning()
      setDate(start)
      setTime(timeOf(start))
    }
    setOpen(next)
  }

  function lockUntil() {
    if (!date) return
    const [h, m] = time.split(":").map(Number)
    save({ releaseAt: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).toISOString() })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="icon"
          className={`size-7 ${locked ? "text-amber-700 hover:text-amber-800" : ""}`}
          disabled={!hasLessons}
          title={!hasLessons ? "Add a lesson first" : locked ? `Opens ${releaseLabel(releaseAt!)}` : "Set a release date"}
          aria-label={locked ? "Change release date" : "Set release date"}
        >
          {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold">Release date</p>
          <p className="text-xs text-muted-foreground">
            Students see this section locked until it opens on:
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <DatePicker value={date} onChange={setDate} placeholder="Pick a date" />
          <select value={time} onChange={(e) => setTime(e.target.value)} className={selectClass} aria-label="Time">
            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          {locked && (
            <Button variant="outline" size="sm" className="flex-1" disabled={loading} onClick={() => save({ releaseAt: null })}>
              <LockOpen className="size-3.5 mr-1.5" /> Open now
            </Button>
          )}
          <Button size="sm" className="flex-1" disabled={loading || !date} onClick={lockUntil}>
            {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Lock className="size-3.5 mr-1.5" />}
            {locked ? "Change date" : "Set date"}
          </Button>
        </div>
        {onOpenSchedule && (
          <button
            type="button"
            className="flex items-center gap-1.5 self-start text-xs text-primary hover:underline"
            onClick={() => { setOpen(false); onOpenSchedule() }}
          >
            <CalendarClock className="size-3.5" /> Schedule all sections
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
