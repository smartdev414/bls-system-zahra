"use client"

import { CalendarClock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

/**
 * "When do students get this lesson?" — straight away, or on a date and time,
 * so a term can be prepared in advance and released week by week.
 *
 * The value is the `datetime-local` string the browser edits ("" = straight
 * away); `releaseToIso` / `releaseFromIso` convert to and from what the API stores.
 */

/** ISO from the API → the local value this field edits. */
export function releaseFromIso(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** This field's value → what the API expects (null = straight away). */
export function releaseToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Next Monday 09:00 — a sensible first suggestion for a weekly release. */
function nextMondayMorning(): string {
  const d = new Date()
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7))
  d.setHours(9, 0, 0, 0)
  return releaseFromIso(d.toISOString())
}

export function ReleaseField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const scheduled = value !== ""
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Release to students</Label>
      <div className="grid grid-cols-2 gap-4">
        <Select
          value={scheduled ? "date" : "now"}
          onValueChange={(v) => onChange(v === "date" ? value || nextMondayMorning() : "")}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="now">Straight away</SelectItem>
            <SelectItem value="date">On a date</SelectItem>
          </SelectContent>
        </Select>
        {scheduled && (
          <Input
            type="datetime-local"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Release date and time"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {scheduled
          ? "Students won't see this lesson until then. Teachers can see it now."
          : "Students see this lesson as soon as it is saved."}
      </p>
    </div>
  )
}

/** Shown to staff and teachers on a lesson that students cannot see yet. */
export function ReleaseBadge({ releaseAt, className }: { releaseAt: string | null | undefined; className?: string }) {
  if (!releaseAt) return null
  const when = new Date(releaseAt)
  if (Number.isNaN(when.getTime()) || when <= new Date()) return null
  return (
    <Badge variant="outline" className={`gap-1 bg-amber-100 text-amber-700 border-amber-200 ${className ?? ""}`}>
      <CalendarClock className="size-3" />
      Releases {when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })},{" "}
      {when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
    </Badge>
  )
}
