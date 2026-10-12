"use client"

import { useState } from "react"
import { Loader2, Lock, LockOpen } from "lucide-react"
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
 * The padlock on a section header. One click locks the section until a date
 * (next Monday 09:00 unless changed); on a locked section the same button
 * offers "Unlock now". Students see a locked section with its unlock date.
 */
export function SectionLock({
  courseId,
  sectionId,
  releaseAt,
  hasLessons,
  onSaved,
}: {
  courseId: string
  sectionId: string
  /** The date the section is locked until, or null when it is open. */
  releaseAt: string | null
  hasLessons: boolean
  onSaved: () => void
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
        toast.success(body.releaseAt ? `Locked until ${releaseLabel(body.releaseAt)}` : "Section unlocked")
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
          title={!hasLessons ? "Add a lesson first" : locked ? `Locked until ${releaseLabel(releaseAt!)}` : "Lock until a date"}
          aria-label={locked ? "Change lock" : "Lock section"}
        >
          {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold">{locked ? "Locked" : "Lock this section"}</p>
          <p className="text-xs text-muted-foreground">
            Students see it, but can&apos;t open it until:
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
              <LockOpen className="size-3.5 mr-1.5" /> Unlock now
            </Button>
          )}
          <Button size="sm" className="flex-1" disabled={loading || !date} onClick={lockUntil}>
            {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Lock className="size-3.5 mr-1.5" />}
            {locked ? "Change date" : "Lock"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
