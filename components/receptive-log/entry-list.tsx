"use client"

import { Clapperboard, ClipboardCheck, Globe, HandHeart, MoreHorizontal, Pencil, Trash2, Tv, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACTIVITY_LABEL, hoursLabel, type ReceptiveActivity, type ReceptiveEntry, type ReceptiveTotals } from "@/lib/receptive-log"

export const ACTIVITY_LOOK: Record<ReceptiveActivity, { icon: typeof Tv; color: string }> = {
  TV: { icon: Tv, color: "text-sky-600 bg-sky-50 dark:bg-sky-950/40" },
  FILM: { icon: Clapperboard, color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
  ONLINE: { icon: Globe, color: "text-teal-600 bg-teal-50 dark:bg-teal-950/40" },
  DEAF_EVENT: { icon: Users, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  MET_DEAF: { icon: HandHeart, color: "text-rose-600 bg-rose-50 dark:bg-rose-950/40" },
  PRACTICE: { icon: ClipboardCheck, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  OTHER: { icon: MoreHorizontal, color: "text-muted-foreground bg-muted" },
}

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })

/** This week / last 30 days / all time, as small tiles. */
export function ReceptiveTotalsRow({ totals }: { totals: ReceptiveTotals }) {
  const tiles = [
    { label: "Last 7 days", value: hoursLabel(totals.last7Minutes) },
    { label: "Last 30 days", value: hoursLabel(totals.last30Minutes) },
    { label: "All time", value: hoursLabel(totals.totalMinutes) },
    { label: "Entries", value: String(totals.entries) },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border bg-card p-3 min-w-0">
          <p className="text-[11px] text-muted-foreground">{t.label}</p>
          <p className="text-lg font-black leading-tight tabular-nums truncate">{t.value}</p>
        </div>
      ))}
    </div>
  )
}

type Props = {
  entries: ReceptiveEntry[]
  /** Given on the student's own page; the teacher's view is read-only. */
  onEdit?: (e: ReceptiveEntry) => void
  onDelete?: (e: ReceptiveEntry) => void
  busyId?: string | null
}

/** Entries by month, newest first, with each month's total. */
export function ReceptiveEntryList({ entries, onEdit, onDelete, busyId }: Props) {
  const months = new Map<string, ReceptiveEntry[]>()
  for (const e of entries) {
    const ym = e.date.slice(0, 7)
    months.set(ym, [...(months.get(ym) ?? []), e])
  }

  return (
    <div className="flex flex-col gap-4">
      {[...months.entries()].map(([ym, list]) => (
        <section key={ym} className="rounded-xl border bg-card overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-4 py-2 bg-muted/50 border-b">
            <h3 className="text-sm font-semibold">{monthLabel(ym)}</h3>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {hoursLabel(list.reduce((n, e) => n + e.minutes, 0))}
            </span>
          </header>
          <ul className="divide-y">
            {list.map((e) => {
              const look = ACTIVITY_LOOK[e.activity]
              const Icon = look.icon
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={`rounded-md p-1.5 shrink-0 mt-0.5 ${look.color}`}><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium break-words min-w-0">{e.title}</p>
                      <span className="text-sm font-bold tabular-nums shrink-0">{hoursLabel(e.minutes)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{[e.resource, ACTIVITY_LABEL[e.activity], dayLabel(e.date)].filter(Boolean).join(" · ")}</p>
                    {e.notes && <p className="text-sm mt-1.5 whitespace-pre-wrap break-words text-foreground/90">{e.notes}</p>}
                  </div>
                  {(onEdit || onDelete) && (
                    <div className="flex shrink-0 -mr-2">
                      {onEdit && (
                        <Button variant="ghost" size="icon" className="size-10 sm:size-8" aria-label={`Edit ${e.title}`} onClick={() => onEdit(e)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          variant="ghost" size="icon" className="size-10 sm:size-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${e.title}`} disabled={busyId === e.id} onClick={() => onDelete(e)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
