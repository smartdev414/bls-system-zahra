"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { MAX_WEEK, weekLabel } from "@/lib/class-week"
import { cn } from "@/lib/utils"

/** "Week 3" next to a class's date — which slides the teacher uses. */
export function WeekBadge({ week, className }: { week: number | null | undefined; className?: string }) {
  const label = weekLabel(week)
  if (!label) return null
  return (
    <Badge variant="outline" className={cn("text-[0.625rem] shrink-0 bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", className)}>
      {label}
    </Badge>
  )
}

/**
 * The week of one class, changed right where it is listed: a small dropdown
 * that looks like the badge. Saves as soon as a week is picked.
 */
export function WeekPicker({ sessionId, week, date, onSaved, later = [] }: {
  sessionId: string
  week: number | null
  /** For the label read out by screen readers. */
  date: string
  onSaved: () => void
  /**
   * The classes after this one on the same timetable, in date order. Once a
   * week is picked here, one tap numbers them on (Week 4 → 5, 6, 7…), so a
   * course that already has its classes isn't set up one class at a time.
   */
  later?: string[]
}) {
  const [value, setValue] = useState(week ? String(week) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue(week ? String(week) : "") }, [week])

  async function save(next: string) {
    const before = value
    setValue(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/tutor/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: next ? Number(next) : null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { message?: string }).message)
      const first = Number(next)
      const rest = next ? later.slice(0, MAX_WEEK - first) : []
      if (rest.length > 0) {
        toast.success(`Set to Week ${next}`, {
          description: `Number the ${rest.length} class${rest.length === 1 ? "" : "es"} after it Week ${first + 1}${rest.length > 1 ? `–${first + rest.length}` : ""}?`,
          duration: 12_000,
          action: { label: "Number them", onClick: () => void numberLater(first, rest) },
        })
      } else {
        toast.success(next ? `Set to Week ${next}` : "Week removed")
      }
      onSaved()
    } catch (err) {
      setValue(before)
      toast.error(err instanceof Error && err.message ? err.message : "Could not save the week")
    } finally {
      setSaving(false)
    }
  }

  async function numberLater(first: number, ids: string[]) {
    const id = toast.loading(`Numbering ${ids.length} classes…`)
    try {
      for (const [i, sid] of ids.entries()) {
        const res = await fetch(`/api/tutor/sessions/${sid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week: first + i + 1 }),
        })
        if (!res.ok) throw new Error()
      }
      toast.success(`Week ${first + 1} to Week ${first + ids.length} set`, { id })
    } catch {
      toast.error("Some classes could not be numbered — try again", { id })
    } finally {
      onSaved()
    }
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => void save(e.target.value)}
      aria-label={`Course week of the class on ${date}`}
      title="Which week of the course this class is"
      className={cn(
        "h-6 shrink-0 cursor-pointer rounded-md border px-1.5 text-[0.6875rem] font-semibold outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
        value
          ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900"
          : "border-dashed text-muted-foreground bg-transparent",
      )}
    >
      <option value="">+ Week</option>
      {Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
    </select>
  )
}
