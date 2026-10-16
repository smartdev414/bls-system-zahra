"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, RotateCcw, Trophy, Loader2, Timer, Keyboard, Hand,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import type { SignQuestion } from "@/lib/quiz"
import type { HighScore } from "@/lib/quiz-high-scores"
import { cn } from "@/lib/utils"
import { AttemptHistory, attemptsLeftText, type AttemptSummary } from "./AttemptHistory"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignAnswer = { questionId: string; answerText: string | null; isCorrect: boolean }

export type SignTestData = {
  questions: SignQuestion[]
  settings: {
    passMark: number
    maxAttempts: number | null
    kind: "FINGERSPELLING" | "VOCABULARY"
    answerSeconds: number
    /** How many times each sign plays; null (or absent) = repeats until the time is up. */
    signPlays?: number | null
  }
  /** Newest first. */
  attempts: AttemptSummary[]
  attemptsLeft: number | null
  answersRevealed: boolean
  bestAttempt: (AttemptSummary & { answers: SignAnswer[] }) | null
  /** Fingerspelling only. */
  highScores?: HighScore[]
}

type Result = {
  score: number
  passed: boolean
  correct: number
  total: number
  passMark: number
  attemptsLeft: number | null
  answersRevealed: boolean
  questions: SignQuestion[]
  answers: SignAnswer[]
}

type Props = {
  lessonId: string
  enrollmentId: string | null
  data: SignTestData
  refetch: () => unknown
  onCompleted: () => void
  /** Where "Continue" goes once the test is passed — the next lesson, if there is one. */
  nextHref?: string
}

// A slow connection should not eat into the time: the clock starts when the
// video can play, or after this long if it never says so.
const VIDEO_WAIT_MS = 4000

function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`
}

// ─── High scores ──────────────────────────────────────────────────────────────

function HighScores({ scores, className }: { scores: HighScore[]; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-background", className)}>
      <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Trophy className="size-3.5 text-amber-500" /> High scores
      </p>
      {scores.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">No scores yet — be the first.</p>
      ) : (
        <ol className="divide-y">
          {scores.map((s, i) => (
            <li key={i} className={cn("flex items-center gap-2 px-3 py-2 text-sm", s.isYou && "bg-primary/5 font-semibold")}>
              <span className={cn("w-4 shrink-0 text-xs", i === 0 ? "text-amber-500 font-bold" : "text-muted-foreground")}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{s.isYou ? "You" : s.name}</span>
              {s.durationMs !== null && <span className="text-xs font-normal text-muted-foreground">{seconds(s.durationMs)}</span>}
              <span className="tabular-nums">{s.score}%</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ─── One sign, against the clock ──────────────────────────────────────────────

export function SignRound({ sign, kind, answerSeconds, plays = null, number, total, onAnswer, aside }: {
  sign: SignQuestion
  kind: SignTestData["settings"]["kind"]
  answerSeconds: number
  /** Plays of the video before it is hidden; null = it loops until the time is up. */
  plays?: number | null
  number: number
  total: number
  /** Called once: with the word given, or whatever was typed when the time ran out. */
  onAnswer: (text: string) => void
  /** Shown under the timer on a wide screen. */
  aside?: React.ReactNode
}) {
  const totalMs = answerSeconds * 1000
  const [ready, setReady] = useState(false)
  // A test set to play each sign once or twice: which play this is, and
  // whether they are used up (the video is then hidden).
  const [play, setPlay] = useState(1)
  const [playsUsed, setPlaysUsed] = useState(false)
  const [leftMs, setLeftMs] = useState(totalMs)
  const [typed, setTyped] = useState("")
  const typedRef = useRef("")
  const doneRef = useRef(false)
  const onAnswerRef = useRef(onAnswer)
  useEffect(() => { onAnswerRef.current = onAnswer })

  function finish(text: string) {
    if (doneRef.current) return
    doneRef.current = true
    onAnswerRef.current(text)
  }

  useEffect(() => {
    const wait = setTimeout(() => setReady(true), VIDEO_WAIT_MS)
    return () => clearTimeout(wait)
  }, [])

  useEffect(() => {
    if (!ready) return
    const deadline = Date.now() + totalMs
    const tick = setInterval(() => {
      const left = deadline - Date.now()
      setLeftMs(Math.max(0, left))
      if (left <= 0) {
        clearInterval(tick)
        finish(typedRef.current)
      }
    }, 100)
    return () => clearInterval(tick)
  }, [ready, totalMs])

  const secondsLeft = Math.ceil(leftMs / 1000)
  const urgent = ready && secondsLeft <= 3

  const timer = (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-center transition-colors",
        urgent ? "border-rose-300 bg-rose-50 text-rose-700" : "bg-background"
      )}
    >
      <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <Timer className="size-3.5" /> Timer
      </p>
      <p className="text-4xl font-black tabular-nums leading-tight" role="timer" aria-label={`${secondsLeft} seconds left`}>
        {secondsLeft}
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", urgent ? "bg-rose-500" : "bg-primary")}
          style={{ width: `${(leftMs / totalMs) * 100}%` }}
        />
      </div>
    </div>
  )

  // Practice from the dictionary can bring a sign that only has a picture.
  const video = sign.imageUrl && sign.mediaType === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sign.imageUrl}
      alt="The sign"
      onLoad={() => setReady(true)}
      onError={() => setReady(true)}
      className="w-full aspect-video rounded-xl border bg-black object-contain select-none pointer-events-none"
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
    />
  ) : sign.imageUrl && (
    <div className="relative">
      <ProtectedVideo
        src={sign.imageUrl}
        autoPlay muted playsInline
        loop={!plays}
        onCanPlay={() => setReady(true)}
        onError={() => setReady(true)}
        onEnded={(e) => {
          if (!plays) return
          if (play < plays) {
            const v = e.currentTarget
            v.currentTime = 0
            void v.play().catch(() => { /* muted autoplay is allowed; nothing to do */ })
            setPlay(play + 1)
          } else {
            setPlaysUsed(true)
          }
        }}
        // No scrubbing back when the plays are limited — that would be a replay.
        controls={false}
        className="w-full aspect-video rounded-xl border bg-black object-contain"
      />
      {plays && !playsUsed && (
        <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
          {plays === 1 ? "Once only" : `Play ${play} of ${plays}`}
        </span>
      )}
      {playsUsed && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-900 text-center text-white">
          <p className="px-4 text-base font-semibold">
            {kind === "FINGERSPELLING" ? "Type what you saw" : "Pick the word you saw"}
          </p>
        </div>
      )}
    </div>
  )

  const choices = sign.choices ?? []
  const half = Math.ceil(choices.length / 2)
  const choiceButton = (word: string) => (
    <Button
      key={word}
      type="button"
      variant="outline"
      className="h-auto min-h-14 whitespace-normal break-words px-3 py-3 text-base font-semibold"
      onClick={() => finish(word)}
    >
      {word}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Sign {number} of {total}</p>
        <Progress value={((number - 1) / total) * 100} className="h-1.5" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="flex flex-col gap-4">
          {/* On a phone the timer sits above the video, where it can be seen while answering. */}
          <div className="lg:hidden">{timer}</div>

          {kind === "FINGERSPELLING" ? (
            <>
              {video}
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); finish(typed) }}
              >
                <Input
                  autoFocus
                  value={typed}
                  onChange={(e) => { setTyped(e.target.value); typedRef.current = e.target.value }}
                  placeholder="Type here"
                  aria-label="Type the word being fingerspelled"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={100}
                  className="h-14 text-center text-xl font-semibold uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal"
                />
                <Button type="submit" className="h-14 px-5">
                  Next <ChevronRight className="size-4 ml-1" />
                </Button>
              </form>
            </>
          ) : (
            // The sign in the middle with the words around it; on a phone, the words below.
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_2fr_1fr] sm:items-center">
              <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">{video}</div>
              <div className="flex flex-col gap-3 sm:col-start-1 sm:row-start-1">{choices.slice(0, half).map(choiceButton)}</div>
              <div className="flex flex-col gap-3 sm:col-start-3 sm:row-start-1">{choices.slice(half).map(choiceButton)}</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="hidden lg:block">{timer}</div>
          {aside}
        </div>
      </div>
    </div>
  )
}

// ─── 3, 2, 1 — so the first sign does not catch anyone out ────────────────────

export function GetReady({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(3)
  useEffect(() => {
    const tick = setTimeout(() => (count > 1 ? setCount(count - 1) : onDone()), 800)
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center" aria-live="assertive">
      <p className="text-sm font-medium text-muted-foreground">Get ready</p>
      <p key={count} className="text-7xl font-black text-primary tabular-nums animate-in zoom-in-50 duration-300">{count}</p>
    </div>
  )
}

// ─── Review — what was answered for each sign ─────────────────────────────────

export function Review({ questions, answers, answersRevealed, onBack }: {
  questions: SignQuestion[]
  answers: SignAnswer[]
  /** False while the test can still be retaken: the words that were missed stay hidden. */
  answersRevealed: boolean
  onBack: () => void
}) {
  const right = answers.filter((a) => a.isCorrect).length
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold">Review Answers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{right} of {questions.length} correct</p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4 mr-1" /> Back
        </Button>
      </div>

      {!answersRevealed && (
        <p className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          You can see which of your answers were right. The words you missed are shown once you pass or have no attempts left.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => {
          const answer = answers.find((a) => a.questionId === q.id)
          // A sign added after this attempt was never put to the student.
          if (!answer) return null
          return (
            <div
              key={q.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3",
                answer.isCorrect ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
              )}
            >
              {q.imageUrl && q.mediaType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.imageUrl} alt="" className="w-full aspect-video rounded-lg bg-black object-contain" draggable={false} />
              ) : q.imageUrl && (
                <ProtectedVideo src={q.imageUrl} muted loop playsInline controls className="w-full aspect-video rounded-lg bg-black object-contain" />
              )}
              <div className="flex items-start gap-2 text-sm">
                {answer.isCorrect
                  ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {answer.answerText ? `You answered: ${answer.answerText}` : "Ran out of time"}
                  </p>
                  {!answer.isCorrect && q.answer && (
                    <p className="text-emerald-700 break-words">The word: {q.answer}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Button variant="outline" className="self-start" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
    </div>
  )
}

// ─── SignTestTaker ────────────────────────────────────────────────────────────

/**
 * A fingerspelling or vocabulary test as the student plays it: a start screen,
 * the signs one at a time against the clock, then the result. A sign moves on
 * as soon as it is answered or its time is up, and there is no going back.
 */
export function SignTestTaker({ lessonId, enrollmentId, data, refetch, onCompleted, nextHref }: Props) {
  const { questions, settings, attempts, bestAttempt, highScores } = data
  const fingerspelling = settings.kind === "FINGERSPELLING"

  const [view, setView] = useState<"start" | "ready" | "playing" | "sending" | "result" | "review-result" | "review-best">("start")
  // The signs of this go, in the order they come up — a new order each time.
  const [round, setRound] = useState<SignQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const answersRef = useRef<Record<string, string>>({})
  const startedAtRef = useRef(0)
  const tookMsRef = useRef(0)

  if (questions.length === 0) {
    return (
      <div className="text-center py-6">
        <Hand className="size-10 text-primary mx-auto mb-2" />
        <p className="font-semibold">No signs yet</p>
        <p className="text-sm text-muted-foreground mt-1">The signs for this test haven&apos;t been added yet.</p>
      </div>
    )
  }

  const hasPassed = attempts.some((a) => a.passed)
  const canAttempt = data.attemptsLeft !== 0

  function start() {
    answersRef.current = {}
    setRound(shuffled(questions))
    setIndex(0)
    setResult(null)
    setError(null)
    setView("ready")
  }

  async function send() {
    setView("sending")
    setError(null)
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: round.map((q) => ({ questionId: q.id, text: answersRef.current[q.id] ?? "" })),
          durationMs: tookMsRef.current,
        }),
      })
      const body = await res.json() as Omit<Result, "answers"> & { attempt: { answers: SignAnswer[] }; message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not send your answers")
      setResult({ ...body, answers: body.attempt.answers })
      setView("result")
      if (body.passed) onCompleted()
      // Pick up the new attempt and the high scores.
      void refetch()
    } catch (e) {
      // The answers are still held — nothing is lost, they can be sent again.
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

  if (view === "ready") {
    return <GetReady onDone={() => { startedAtRef.current = Date.now(); setView("playing") }} />
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (view === "playing" && round[index]) {
    return (
      <SignRound
        // A fresh clock and a fresh box to type in for every sign.
        key={round[index].id}
        sign={round[index]}
        kind={settings.kind}
        answerSeconds={settings.answerSeconds}
        plays={settings.signPlays ?? null}
        number={index + 1}
        total={round.length}
        onAnswer={answer}
        aside={highScores && <HighScores scores={highScores} className="hidden lg:block" />}
      />
    )
  }

  if (view === "sending") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center" aria-live="polite">
        {error ? (
          <>
            <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
            <Button onClick={send}><RotateCcw className="size-4 mr-1.5" /> Send again</Button>
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

  // ── Result ────────────────────────────────────────────────────────────────
  if (view === "result" && result) {
    const left = attemptsLeftText(result.attemptsLeft)
    return (
      <div className="flex flex-col items-center gap-6 py-8 px-4 text-center" aria-live="polite">
        <div className={cn("size-24 rounded-full flex items-center justify-center", result.passed ? "bg-emerald-100" : "bg-rose-100")}>
          {result.passed ? <Trophy className="size-12 text-emerald-600" /> : <XCircle className="size-12 text-rose-500" />}
        </div>

        <div>
          <p className="text-3xl font-black">{result.score}%</p>
          <p className="text-muted-foreground mt-1">
            {result.correct} / {result.total} correct · {seconds(tookMsRef.current)}
          </p>
        </div>

        <Badge
          variant="outline"
          className={cn(
            "text-sm px-4 py-1",
            result.passed ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-rose-100 text-rose-700 border-rose-200"
          )}
        >
          {result.passed ? "Passed" : `Not passed — need ${result.passMark}%`}
        </Badge>

        {result.attemptsLeft === 0 && !result.passed && (
          <p className="text-sm text-muted-foreground max-w-sm">
            You have no attempts left. Speak to your teacher if you need another go.
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={() => setView("review-result")}>Review answers</Button>
          {result.attemptsLeft !== 0 && (
            <Button onClick={start} variant={result.passed && nextHref ? "outline" : "default"}>
              <RotateCcw className="size-4 mr-1.5" /> Play again
            </Button>
          )}
          {result.passed && nextHref && (
            <Button asChild>
              <Link href={nextHref}>Continue <ChevronRight className="size-4 ml-1" /></Link>
            </Button>
          )}
        </div>

        {left && result.attemptsLeft !== 0 && <p className="text-xs text-muted-foreground">{left}.</p>}

        {highScores && <HighScores scores={highScores} className="w-full max-w-sm text-left" />}
      </div>
    )
  }

  if (view === "review-result" && result) {
    return (
      <Review
        questions={result.questions}
        answers={result.answers}
        answersRevealed={result.answersRevealed}
        onBack={() => setView("result")}
      />
    )
  }

  if (view === "review-best" && bestAttempt) {
    return (
      <Review
        questions={questions}
        answers={bestAttempt.answers}
        answersRevealed={data.answersRevealed}
        onBack={() => setView("start")}
      />
    )
  }

  // ── Start screen — how it is played, and how previous goes went ────────────
  const left = attemptsLeftText(data.attemptsLeft)
  const Icon = fingerspelling ? Keyboard : Hand
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn("size-16 rounded-full flex items-center justify-center", hasPassed ? "bg-emerald-100" : "bg-primary/10")}>
          {hasPassed ? <Trophy className="size-8 text-emerald-600" /> : <Icon className="size-8 text-primary" />}
        </div>
        {bestAttempt && (
          <div>
            <p className="text-2xl font-black">{bestAttempt.score}%</p>
            <p className="text-sm text-muted-foreground">
              {hasPassed ? "Passed — your best score" : `Your best score so far — you need ${settings.passMark}% to pass`}
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground max-w-sm">
          {fingerspelling
            ? "Watch each word being fingerspelled and type it."
            : "Watch each sign and pick the right word."}
          {" "}You have {settings.answerSeconds} seconds for each one, then the next comes up.
          {settings.signPlays === 1 && " Each one is shown once only — watch closely!"}
          {settings.signPlays === 2 && " Each one is shown twice."}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-center">
        {[
          { label: "Signs", value: questions.length },
          { label: "Time each", value: `${settings.answerSeconds} sec` },
          { label: "Pass mark", value: `${settings.passMark}%` },
          {
            label: "Attempts",
            value: settings.maxAttempts === null ? "Unlimited" : `${attempts.length} of ${settings.maxAttempts}`,
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border bg-muted/20 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {canAttempt ? (
          <Button onClick={start} disabled={!enrollmentId} size="lg">
            {attempts.length === 0 ? "Start" : <><RotateCcw className="size-4 mr-1.5" /> Play again</>}
          </Button>
        ) : !hasPassed && (
          <p className="text-sm text-muted-foreground">
            You have no attempts left. Speak to your teacher if you need another go.
          </p>
        )}
        {bestAttempt && (
          <Button variant="outline" size="lg" onClick={() => setView("review-best")}>Review answers</Button>
        )}
      </div>

      {canAttempt && left && (
        <p className="text-xs text-muted-foreground text-center">{left}.</p>
      )}

      {!enrollmentId && (
        <p className="text-xs text-muted-foreground text-center">Enrol in this course to take this test.</p>
      )}

      {highScores && <HighScores scores={highScores} className="mx-auto w-full max-w-sm" />}

      <AttemptHistory attempts={attempts} />
    </div>
  )
}
