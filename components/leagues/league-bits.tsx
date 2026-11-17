import { EyeOff, Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DIFFICULTY_INFO, type LeagueDifficulty } from "@/lib/leagues"
import { cn } from "@/lib/utils"

// Small pieces the student and teacher league screens share.

export function DifficultyBadge({ difficulty, className }: { difficulty: LeagueDifficulty; className?: string }) {
  return (
    <Badge variant="outline" className={cn("text-[0.6875rem]", DIFFICULTY_INFO[difficulty].badge, className)}>
      {DIFFICULTY_INFO[difficulty].label}
    </Badge>
  )
}

/** "30 Nov 2026" — the last day of a league. The end is kept as the end of that day in UTC. */
export function leagueEndDay(endsAt: string): string {
  return new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

/** "Runs until 30 Nov 2026", "Finished 30 Nov 2026", or nothing for a league with no end. */
export function leagueWhen(endsAt: string | null, open: boolean): string | null {
  if (!endsAt) return null
  return open ? `Runs until ${leagueEndDay(endsAt)}` : `Finished ${leagueEndDay(endsAt)}`
}

export function seconds(ms: number | null): string | null {
  return ms === null ? null : `${(ms / 1000).toFixed(1)}s`
}

export type TableRow = {
  rank: number
  name: string
  score: number
  durationMs: number | null
  isYou?: boolean
  /** Kept off the table other students see (User.hideFromLeagueTables). */
  hidden?: boolean
}

/** A league table. Gold, silver and bronze for the top three. */
export function LeagueTable({ rows, empty, className }: { rows: TableRow[]; empty: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-background overflow-hidden", className)}>
      <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Trophy className="size-3.5 text-amber-500" /> League table
      </p>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="divide-y">
          {rows.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", r.isYou && "bg-primary/5 font-semibold")}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  r.rank === 1 ? "bg-amber-400 text-amber-950"
                    : r.rank === 2 ? "bg-zinc-300 text-zinc-800"
                    : r.rank === 3 ? "bg-orange-300 text-orange-950"
                    : "text-muted-foreground",
                )}
              >
                {r.rank}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.hidden && (
                <span
                  className="flex items-center gap-1 text-[0.6875rem] font-normal text-muted-foreground shrink-0"
                  title={r.isYou ? "Other students can't see your name or score" : "Other students can't see this student on the table"}
                >
                  <EyeOff className="size-3.5" /> Private
                </span>
              )}
              {r.durationMs !== null && <span className="text-xs font-normal text-muted-foreground tabular-nums">{seconds(r.durationMs)}</span>}
              <span className="w-11 text-right tabular-nums">{r.score}%</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
