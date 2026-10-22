"use client"

import { useState } from "react"
import {
  CalendarX, Keyboard, Loader2, Medal, MoreHorizontal, Pencil, Play, Plus, Trash2, Trophy, Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DifficultyBadge, LeagueTable, leagueWhen, type TableRow } from "@/components/leagues/league-bits"
import { LeagueFormDialog, type EditableLeague } from "@/components/leagues/LeagueFormDialog"
import { useFetch } from "@/hooks/use-fetch"
import { DIFFICULTY_INFO, type LeagueDifficulty } from "@/lib/leagues"
import { cn } from "@/lib/utils"

type LeagueRow = EditableLeague & {
  createdAt: string
  test: { id: string; title: string; wordCount: number } | null
  memberCount: number
  goes: number
  leader: { name: string; score: number } | null
  createdByName: string | null
  canEdit: boolean
}

type LeagueDetail = {
  standings: Array<TableRow & { userId: string; goes: number }>
  waiting: Array<{ userId: string; name: string }>
}

function isOpen(league: { endsAt: string | null }) {
  return !league.endsAt || new Date(league.endsAt) > new Date()
}

// Fingerspelling leagues — competitions students of any level choose to join.
// Shared by the tutor and admin portals.
export default function LeaguesPage() {
  const { data, loading, refetch } = useFetch<{ leagues: LeagueRow[] }>("/api/leagues", {
    errorMessage: "Could not load the leagues",
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LeagueRow | null>(null)
  const [viewing, setViewing] = useState<LeagueRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function change(league: LeagueRow, body: Record<string, unknown>, done: string) {
    setBusy(league.id)
    try {
      const res = await fetch(`/api/leagues/${league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(d.message ?? "Could not change the league")
      toast.success(done)
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the league")
    } finally {
      setBusy(null)
    }
  }

  async function remove(league: LeagueRow) {
    if (!window.confirm(`Delete "${league.title}"? Its table and every score in it are deleted.`)) return
    setBusy(league.id)
    try {
      const res = await fetch(`/api/leagues/${league.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("League deleted")
      await refetch()
    } catch {
      toast.error("Could not delete the league")
    } finally {
      setBusy(null)
    }
  }

  const leagues = data?.leagues ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Trophy className="size-6 text-primary" />
            Fingerspelling leagues
          </h1>
          <p className="text-muted-foreground mt-1">Competitions any student can join, whatever their level.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="size-4 mr-1.5" /> New league</Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-60"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : leagues.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-14 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-6"><Keyboard className="size-10 text-muted-foreground" /></div>
            <div>
              <p className="font-semibold text-lg">No leagues yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Start an Easy, a Medium and a Hard league, each with a fingerspelling test&apos;s words. Students choose which to join.
              </p>
            </div>
            <Button onClick={() => setCreating(true)}><Plus className="size-4 mr-1.5" /> Start your first league</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {leagues.map((league) => {
            const open = isOpen(league)
            const when = leagueWhen(league.endsAt, open)
            return (
              <Card key={league.id} className={cn("shadow-sm", busy === league.id && "opacity-60", !open && "bg-muted/30")}>
                <CardContent className="p-4 flex flex-col gap-3 h-full">
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => setViewing(league)} className="flex-1 min-w-0 text-left group">
                      <p className="font-semibold leading-snug group-hover:text-primary break-words">{league.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {league.test ? `${league.test.title} · ${league.test.wordCount} words` : "No words — its test was deleted"}
                        {when && ` · ${when}`}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <DifficultyBadge difficulty={league.difficulty} />
                      {league.canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`More for ${league.title}`} disabled={busy === league.id}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(league)}><Pencil className="size-4" /> Change</DropdownMenuItem>
                            {open ? (
                              <DropdownMenuItem onSelect={() => {
                                if (window.confirm(`End "${league.title}" now? The table becomes final.`)) void change(league, { end: true }, "League ended — the table is final")
                              }}>
                                <CalendarX className="size-4" /> End now
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => change(league, { endsAt: null }, "League running again")}>
                                <Play className="size-4" /> Run again
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove(league)}>
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="size-3.5" /> {league.memberCount} joined</span>
                      {league.leader && (
                        <span className="flex items-center gap-1">
                          <Medal className="size-3.5 text-amber-500" /> {league.leader.name} · {league.leader.score}%
                        </span>
                      )}
                      {league.createdByName && <span>by {league.createdByName}</span>}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setViewing(league)}>Table</Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {creating && <LeagueFormDialog open onOpenChange={setCreating} onSaved={() => void refetch()} />}
      {editing && (
        <LeagueFormDialog
          key={editing.id}
          league={editing}
          open
          onOpenChange={(o) => { if (!o) setEditing(null) }}
          onSaved={() => void refetch()}
        />
      )}
      {viewing && <TableDialog league={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

/** The whole table, with full names, and who has joined but not played. */
function TableDialog({ league, onClose }: { league: LeagueRow; onClose: () => void }) {
  const { data, loading } = useFetch<LeagueDetail>(`/api/leagues/${league.id}`, {
    errorMessage: "Could not load the table",
  })
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {league.title} <DifficultyBadge difficulty={league.difficulty as LeagueDifficulty} />
          </DialogTitle>
          <DialogDescription>
            {DIFFICULTY_INFO[league.difficulty].rules}{" "}Each student&apos;s best go counts; a quicker time wins a tie.
          </DialogDescription>
        </DialogHeader>
        {loading && !data ? (
          <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : data && (
          <div className="flex flex-col gap-4">
            <LeagueTable rows={data.standings} empty="Nobody has played yet." />
            {data.waiting.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Joined, not played yet</p>
                <p className="text-sm text-muted-foreground">{data.waiting.map((w) => w.name).join(", ")}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
