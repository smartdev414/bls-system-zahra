"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Keyboard, Loader2, Medal, Trophy, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DifficultyBadge, leagueWhen } from "@/components/leagues/league-bits"
import { useFetch } from "@/hooks/use-fetch"
import { DIFFICULTY_INFO, ordinal, type LeagueDifficulty } from "@/lib/leagues"
import { cn } from "@/lib/utils"

type LeagueRow = {
  id: string
  title: string
  difficulty: LeagueDifficulty
  endsAt: string | null
  open: boolean
  wordCount: number
  memberCount: number
  joined: boolean
  myRank: number | null
  myScore: number | null
  players: number
  leader: { name: string; score: number } | null
}

const STRIPE: Record<LeagueDifficulty, string> = {
  EASY: "bg-emerald-500",
  MEDIUM: "bg-amber-500",
  HARD: "bg-rose-500",
}

// Fingerspelling leagues: open to every student, whatever their level. Join as
// many as you like and play for a place on the table.
export default function StudentLeaguesPage() {
  const { data, loading, refetch } = useFetch<{ leagues: LeagueRow[] }>("/api/student/leagues", {
    errorMessage: "Could not load the leagues",
  })
  const [joining, setJoining] = useState<string | null>(null)

  async function join(league: LeagueRow) {
    setJoining(league.id)
    try {
      const res = await fetch(`/api/student/leagues/${league.id}/membership`, { method: "POST" })
      const body = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not join the league")
      toast.success(`You joined ${league.title}`)
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join the league")
    } finally {
      setJoining(null)
    }
  }

  const leagues = data?.leagues ?? []
  const running = leagues.filter((l) => l.open)
  const finished = leagues.filter((l) => !l.open)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Trophy className="size-6 text-primary" />
          Fingerspelling leagues
        </h1>
        <p className="text-muted-foreground mt-1">
          Open to every student, whatever your level. Join a league, play as often as you like — your best go counts.
        </p>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : !data ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <p className="font-semibold">The leagues could not be loaded</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : leagues.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-muted p-6"><Keyboard className="size-10 text-muted-foreground" /></div>
            <p className="font-semibold text-lg">No leagues yet</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Your teachers haven&apos;t started a fingerspelling league yet. Check back soon!
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {running.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {running.map((league) => (
                <LeagueCard key={league.id} league={league} joining={joining === league.id} onJoin={() => join(league)} />
              ))}
            </div>
          )}
          {running.length === 0 && (
            <p className="text-sm text-muted-foreground">No leagues are running right now.</p>
          )}

          {finished.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Finished</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {finished.map((league) => <LeagueCard key={league.id} league={league} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function LeagueCard({ league, joining, onJoin }: { league: LeagueRow; joining?: boolean; onJoin?: () => void }) {
  const when = leagueWhen(league.endsAt, league.open)
  const href = `/student/leagues/${league.id}`
  return (
    <Card className={cn("shadow-sm overflow-hidden flex flex-col gap-0 py-0", !league.open && "opacity-80")}>
      <div className={cn("h-1.5", STRIPE[league.difficulty])} />
      <CardContent className="p-5 flex flex-col gap-4 flex-1">
        <div className="flex items-start justify-between gap-3">
          <Link href={href} className="min-w-0 group">
            <p className="font-bold leading-snug group-hover:text-primary break-words">{league.title}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {league.wordCount} word{league.wordCount !== 1 ? "s" : ""}
              {when && ` · ${when}`}
            </p>
          </Link>
          <DifficultyBadge difficulty={league.difficulty} className="shrink-0" />
        </div>

        <p className="text-sm text-muted-foreground">{DIFFICULTY_INFO[league.difficulty].rules}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="size-3.5" /> {league.memberCount} joined</span>
          {league.leader && (
            <span className="flex items-center gap-1 min-w-0">
              <Medal className="size-3.5 text-amber-500 shrink-0" />
              <span className="truncate">{league.open ? "Leader" : "Winner"}: {league.leader.name} · {league.leader.score}%</span>
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {league.myRank !== null ? (
            <p className="text-sm">
              <span className="font-black text-lg">{ordinal(league.myRank)}</span>
              <span className="text-muted-foreground"> of {league.players} · best {league.myScore}%</span>
            </p>
          ) : league.joined ? (
            <p className="text-sm text-muted-foreground">You haven&apos;t played yet</p>
          ) : <span />}

          {!league.open ? (
            <Button asChild size="sm" variant="outline"><Link href={href}>See the table</Link></Button>
          ) : league.joined ? (
            <Button asChild size="sm"><Link href={href}>Play <ChevronRight className="size-4 ml-0.5" /></Link></Button>
          ) : (
            <Button size="sm" onClick={onJoin} disabled={joining}>
              {joining && <Loader2 className="size-4 mr-1.5 animate-spin" />} Join
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
