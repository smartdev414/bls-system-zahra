"use client"

import { use, useRef, useState } from "react"
import Link from "next/link"
import {
  ChevronLeft, Keyboard, Loader2, LogOut, Medal, RotateCcw, Sparkles, Timer, Trophy, Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { GetReady, SignRound } from "@/components/quiz/SignTestTaker"
import { DifficultyBadge, LeagueTable, leagueWhen, seconds, type TableRow } from "@/components/leagues/league-bits"
import { useFetch } from "@/hooks/use-fetch"
import { LeaguePrivacySwitch } from "@/components/leagues/league-privacy-switch"
import { DIFFICULTY_INFO, ordinal, type LeagueDifficulty } from "@/lib/leagues"
import { newOrder, type SignQuestion } from "@/lib/quiz"
import { cn } from "@/lib/utils"

type LeagueData = {
  league: {
    id: string
    title: string
    difficulty: LeagueDifficulty
    endsAt: string | null
    open: boolean
    joined: boolean
    memberCount: number
    wordCount: number
    answerSeconds: number
    signPlays: number | null
  }
  questions: SignQuestion[]
  standings: Array<TableRow & { isYou: boolean }>
  me: { rank: number | null; score: number | null; durationMs: number | null; goes: number; hidden: boolean }
}

type Result = {
  correct: number
  total: number
  score: number
  durationMs: number | null
  rank: number
  players: number
  personalBest: boolean
  firstGo: boolean
}

export default function StudentLeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, loading, refetch } = useFetch<LeagueData>(`/api/student/leagues/${id}`, {
    errorMessage: "Could not load the league",
  })

  const [view, setView] = useState<"home" | "ready" | "playing" | "sending" | "result">("home")
  const [round, setRound] = useState<SignQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const answersRef = useRef<Record<string, string>>({})
  const startedAtRef = useRef(0)
  const tookMsRef = useRef(0)

  if (!data) {
    return loading ? (
      <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="size-8 animate-spin text-primary" /></div>
    ) : (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-semibold">This league could not be loaded</p>
        <Button variant="outline" asChild><Link href="/student/leagues">Back to leagues</Link></Button>
      </div>
    )
  }

  const { league, questions, standings, me } = data
  const rules = DIFFICULTY_INFO[league.difficulty]
  const when = leagueWhen(league.endsAt, league.open)
  const canPlay = league.open && league.joined && questions.length > 0

  async function setMembership(join: boolean) {
    if (!join && !window.confirm(`Leave ${league.title}? You come off the table. If you join again, your best score comes back.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/student/leagues/${id}/membership`, { method: join ? "POST" : "DELETE" })
      const body = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(body.message ?? "Something went wrong")
      toast.success(join ? "You're in! Press Play when you're ready." : "You left the league")
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  function start() {
    answersRef.current = {}
    setRound(newOrder(questions, round))
    setIndex(0)
    setResult(null)
    setError(null)
    setView("ready")
  }

  async function send() {
    setView("sending")
    setError(null)
    try {
      const res = await fetch(`/api/student/leagues/${id}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: round.map((q) => ({ questionId: q.id, text: answersRef.current[q.id] ?? "" })),
          durationMs: tookMsRef.current,
        }),
      })
      const body = await res.json() as Result & { message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not send your answers")
      setResult(body)
      setView("result")
      void refetch()
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch"
        ? e.message
        : "Could not send your answers. Check your connection and try again.")
    }
  }

  function answer(text: string) {
    answersRef.current[round[index].id] = text
    if (index + 1 < round.length) {
      setIndex(index + 1)
      return
    }
    tookMsRef.current = Date.now() - startedAtRef.current
    void send()
  }

  // ── Playing — the same clock as a fingerspelling test ─────────────────────
  if (view === "ready") {
    return <GetReady onDone={() => { startedAtRef.current = Date.now(); setView("playing") }} />
  }
  if (view === "playing" && round[index]) {
    return (
      <SignRound
        key={round[index].id}
        sign={round[index]}
        kind="FINGERSPELLING"
        answerSeconds={league.answerSeconds}
        plays={league.signPlays}
        number={index + 1}
        total={round.length}
        onAnswer={answer}
        aside={<LeagueTable rows={standings.slice(0, 5)} empty="No scores yet — be the first." className="hidden lg:block" />}
      />
    )
  }
  if (view === "sending") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" aria-live="polite">
        {error ? (
          <>
            <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
            <div className="flex gap-2">
              <Button onClick={send}><RotateCcw className="size-4 mr-1.5" /> Send again</Button>
              <Button variant="outline" onClick={() => setView("home")}>Back</Button>
            </div>
          </>
        ) : (
          <>
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Marking your answers…</p>
          </>
        )}
      </div>
    )
  }

  // ── Result — the score, and where it puts them ────────────────────────────
  if (view === "result" && result) {
    const podium = result.rank <= 3 && result.score > 0
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-8 text-center" aria-live="polite">
        <div className={cn("size-24 rounded-full flex items-center justify-center", podium ? "bg-amber-100" : "bg-primary/10")}>
          {podium ? <Trophy className="size-12 text-amber-500" /> : <Keyboard className="size-12 text-primary" />}
        </div>
        <div>
          <p className="text-4xl font-black">{result.score}%</p>
          <p className="text-muted-foreground mt-1">
            {result.correct} of {result.total} words right{result.durationMs !== null && ` · ${seconds(result.durationMs)}`}
          </p>
        </div>
        {result.personalBest ? (
          <p className="flex items-center gap-1.5 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-800">
            <Sparkles className="size-4" />
            {result.firstGo ? "You're on the table" : "New personal best"} — {ordinal(result.rank)} of {result.players}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your best go still counts — you&apos;re {ordinal(result.rank)} of {result.players}.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={start}><RotateCcw className="size-4 mr-1.5" /> Play again</Button>
          {/* The table may still be catching up with this go. */}
          <Button variant="outline" onClick={() => { void refetch(); setView("home") }}>See the table</Button>
        </div>
      </div>
    )
  }

  // ── The league ────────────────────────────────────────────────────────────
  const winner = !league.open ? standings[0] : null
  return (
    <div className="flex flex-col gap-6">
      <Link href="/student/leagues" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground self-start">
        <ChevronLeft className="size-4" /> All leagues
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black tracking-tight break-words">{league.title}</h1>
            <DifficultyBadge difficulty={league.difficulty} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm flex flex-wrap gap-x-3 gap-y-1">
            <span className="flex items-center gap-1"><Keyboard className="size-3.5" /> {league.wordCount} words</span>
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {league.memberCount} joined</span>
            {when && <span className="flex items-center gap-1"><Timer className="size-3.5" /> {when}</span>}
          </p>
        </div>
        {league.joined && league.open && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setMembership(false)} disabled={busy}>
            <LogOut className="size-4 mr-1.5" /> Leave
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="shadow-sm">
          <CardContent className="p-6 flex flex-col items-center gap-5 text-center">
            {winner ? (
              <>
                <div className="size-16 rounded-full bg-amber-100 flex items-center justify-center"><Trophy className="size-8 text-amber-500" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">This league has finished. The winner is</p>
                  <p className="text-2xl font-black mt-1">{winner.name} — {winner.score}%</p>
                </div>
                {me.rank !== null && !winner.isYou && (
                  <p className="text-sm">You came <span className="font-bold">{ordinal(me.rank)}</span> of {standings.length}.</p>
                )}
              </>
            ) : !league.open ? (
              <p className="text-muted-foreground">This league has finished. Nobody played it.</p>
            ) : (
              <>
                <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
                  {me.rank !== null ? <Medal className="size-8 text-primary" /> : <Keyboard className="size-8 text-primary" />}
                </div>
                {me.rank !== null && (
                  <div>
                    <p className="text-3xl font-black">{ordinal(me.rank)}</p>
                    <p className="text-sm text-muted-foreground">
                      of {standings.length} · your best {me.score}%{me.durationMs !== null && ` in ${seconds(me.durationMs)}`}
                    </p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground max-w-sm">
                  Watch each word being fingerspelled and type it. {rules.rules} Play as often as you like — only your best go counts. A quicker time wins a tie.
                </p>
                {!league.joined ? (
                  <Button size="lg" onClick={() => setMembership(true)} disabled={busy}>
                    {busy && <Loader2 className="size-4 mr-1.5 animate-spin" />} Join this league
                  </Button>
                ) : canPlay ? (
                  <Button size="lg" onClick={start}>
                    {me.goes === 0 ? "Play" : <><RotateCcw className="size-4 mr-1.5" /> Play again</>}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">The words for this league are being changed. Check back soon.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <LeagueTable
            rows={standings}
            empty={league.open ? "No scores yet — be the first." : "No scores."}
          />
          <LeaguePrivacySwitch hidden={me.hidden} onChanged={() => void refetch()} />
        </div>
      </div>
    </div>
  )
}
