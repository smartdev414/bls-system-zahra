"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Camera, CheckCircle2, ChevronRight, Clapperboard, Clock, Eye, Hourglass, Loader2, PenLine, Play, RotateCcw, Trophy, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { correctNeeded, marksLabel, maxMarks } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { AttemptHistory, attemptsLeftText, type AttemptSummary } from "./AttemptHistory"
import { AnswerAndModel, MarkAnswers, MarksBadge, type MarkAnswer, type MarkQuestion } from "./SelfMarking"
import { SignAnswerRecorder } from "./SignAnswerRecorder"

// An assessment, sat the way the old DVDs ran it: a short synopsis, then for
// each part its questions, the part itself, and a set time to film the
// answers. The student goes through it one step at a time, in order. Once the
// answers are in, they mark them against the answer sheet — or, when the
// teacher marks, they wait for the teacher.

type Part = {
  id: string
  /** The questions written out, if the teacher added them. */
  question: string
  type: string
  imageUrl: string | null
  mediaType: string | null
  questionsVideoUrl: string | null
  maxMarks: number | null
  /** The answer sheet — only once the student may mark against it (or has been marked). */
  modelAnswer?: string | null
}

type AttemptWithAnswers = AttemptSummary & { selfMarked?: boolean; answers: MarkAnswer[] }

export type AssessmentData = {
  questions: Part[]
  settings: {
    passMark: number
    maxAttempts: number | null
    storyUrl: string | null
    storyControls?: boolean
    answerMinutes: number
    tutorMarks: boolean
  }
  attempts: Array<AttemptSummary & { selfMarked?: boolean }>
  attemptsLeft: number | null
  bestAttempt: AttemptWithAnswers | null
  pendingAttempt: AttemptWithAnswers | null
}

type Step = { kind: "synopsis" } | { kind: "questions" | "part" | "answer"; part: number }

const STEP_NAME = { synopsis: "Watch the synopsis", questions: "Watch the questions", part: "Watch the part", answer: "Film your answers" }

function stepsOf(data: AssessmentData): Step[] {
  const steps: Step[] = data.settings.storyUrl ? [{ kind: "synopsis" }] : []
  data.questions.forEach((_, part) => {
    if (data.questions[part].questionsVideoUrl) steps.push({ kind: "questions", part })
    steps.push({ kind: "part", part }, { kind: "answer", part })
  })
  return steps
}

/** As a marking question: the answers are filmed, marked against the answer sheet. */
const asMarkQuestion = (p: Part): MarkQuestion => ({ ...p, filmed: true })

// ─── Where the student is, kept on the device ─────────────────────────────────
// An assessment takes the best part of an hour; a refresh or a dropped
// connection must not send them back to the start, nor give them a new clock.

type Saved = { step: number; videos: Record<string, string>; deadline: number | null; startedAt: number }

function progressKey(lessonId: string, enrollmentId: string | null) {
  return `assessment:${lessonId}:${enrollmentId ?? "preview"}`
}
function readProgress(key: string): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Saved | null
    return raw && typeof raw.step === "number" ? raw : null
  } catch {
    return null
  }
}
function writeProgress(key: string, progress: Saved | null) {
  try {
    if (progress) localStorage.setItem(key, JSON.stringify(progress))
    else localStorage.removeItem(key)
  } catch { /* private mode: it just is not kept */ }
}

/** 905 → "15:05". */
function clock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * A video watched as a step. Without controls it plays through once, as on the
 * DVD; it starts on a tap, so a phone that blocks autoplay never leaves the
 * student stuck. `onDone` once it has ended (or cannot be played).
 */
function WatchVideo({ src, controls, onDone }: { src: string; controls: boolean; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <ProtectedVideo
          ref={ref}
          src={src}
          playsInline
          controls={controls && started}
          onPlay={() => setStarted(true)}
          onEnded={onDone}
          onError={() => { setFailed(true); onDone() }}
          className="w-full max-h-[60vh] rounded-xl border bg-black"
        />
        {!started && !failed && (
          <button
            type="button"
            onClick={() => { void ref.current?.play().catch(() => {}); setStarted(true) }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/50 text-white"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-primary shadow-lg">
              <Play className="size-8 fill-current" />
            </span>
            <span className="text-base font-semibold">Play</span>
          </button>
        )}
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">This video could not be played. You can carry on, and tell your teacher.</p>}
      {!controls && started && !failed && (
        <p className="text-xs text-muted-foreground">It plays through once, as in the real assessment.</p>
      )}
    </div>
  )
}

export function AssessmentTaker({ lessonId, enrollmentId, data, refetch, onCompleted, nextHref }: {
  lessonId: string
  enrollmentId: string | null
  data: AssessmentData
  refetch: () => void | Promise<unknown>
  onCompleted: () => void
  nextHref?: string
}) {
  const key = progressKey(lessonId, enrollmentId)
  const [progress, setProgress] = useState<Saved | null>(() => readProgress(key))
  const [view, setView] = useState<"start" | "taking" | "marking" | "sent" | "result" | "review">("start")
  const [stepDone, setStepDone] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSent, setJustSent] = useState<{ attemptId: string; parts: Part[]; answers: MarkAnswer[] } | null>(null)
  const [result, setResult] = useState<{ score: number; passed: boolean; earned: number; total: number; attemptsLeft: number | null; answers: MarkAnswer[]; parts: Part[] } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const { questions: parts, settings, attempts } = data
  const steps = stepsOf(data)
  const controls = settings.storyControls === true

  useEffect(() => { writeProgress(key, progress) }, [key, progress])

  // The clock while answers are filmed.
  const answering = view === "taking" && progress?.deadline != null
  useEffect(() => {
    if (!answering) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [answering])

  // Leaving part-way asks first: the clock keeps running.
  useEffect(() => {
    if (view !== "taking") return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [view])

  if (parts.length === 0) {
    return (
      <div className="text-center py-6">
        <Clapperboard className="size-10 text-primary mx-auto mb-2" />
        <p className="font-semibold">Not ready yet</p>
        <p className="text-sm text-muted-foreground mt-1">The parts of this assessment haven&apos;t been added yet.</p>
      </div>
    )
  }

  const totalMarks = parts.reduce((sum, p) => sum + maxMarks(p), 0)
  const hasPassed = attempts.some((a) => a.passed)
  const canAttempt = data.attemptsLeft !== 0
  const pending = data.pendingAttempt

  function goTo(step: number, videos = progress?.videos ?? {}) {
    const next = steps[step]
    setProgress({
      step,
      videos,
      deadline: next?.kind === "answer" ? Date.now() + settings.answerMinutes * 60_000 : null,
      startedAt: progress?.startedAt ?? Date.now(),
    })
    setStepDone(false)
    setNow(Date.now())
    setError(null)
    topRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  function start() {
    setResult(null)
    setJustSent(null)
    setView("taking")
    setProgress({ step: 0, videos: {}, deadline: steps[0]?.kind === "answer" ? Date.now() + settings.answerMinutes * 60_000 : null, startedAt: Date.now() })
    setStepDone(false)
  }

  async function submit(videos: Record<string, string>) {
    if (!enrollmentId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: parts.map((p) => ({ questionId: p.id, videoUrl: videos[p.id] })),
          durationMs: progress ? Date.now() - progress.startedAt : undefined,
        }),
      })
      const body = await res.json().catch(() => ({})) as {
        attempt?: { id: string; answers: MarkAnswer[] }; questions?: Part[]; selfMarked?: boolean; passed?: boolean
        score?: number; correct?: number; total?: number; attemptsLeft?: number | null; message?: string
      }
      if (!res.ok || !body.attempt) throw new Error(body.message ?? "Could not send your answers")
      setProgress(null)
      const sent = { attemptId: body.attempt.id, parts: body.questions ?? parts, answers: body.attempt.answers }
      setJustSent(sent)
      if (body.selfMarked) {
        // Nothing was filmed: there is nothing to mark, and the score is in.
        setResult({ score: body.score ?? 0, passed: !!body.passed, earned: body.correct ?? 0, total: body.total ?? totalMarks, attemptsLeft: body.attemptsLeft ?? null, ...sent })
        setView("result")
      } else {
        setView(settings.tutorMarks ? "sent" : "marking")
      }
      void refetch()
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not send your answers. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Marking against the answer sheet ──────────────────────────────────────
  if (view === "marking") {
    const marking = justSent ?? (pending && { attemptId: pending.id, parts, answers: pending.answers })
    if (marking) {
      return (
        <MarkAnswers
          lessonId={lessonId}
          attemptId={marking.attemptId}
          questions={marking.parts.map(asMarkQuestion)}
          answers={marking.answers}
          onMarked={(marked, marks) => {
            setResult({
              ...marked,
              parts: marking.parts,
              answers: marking.answers.map((a) => (a.questionId in marks ? { ...a, marks: marks[a.questionId] } : a)),
            })
            setView("result")
            if (marked.passed) onCompleted()
            void refetch()
          }}
        />
      )
    }
  }

  // ── Sent in, for the teacher to mark ──────────────────────────────────────
  if (view === "sent") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 text-center" aria-live="polite">
        <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center">
          <CheckCircle2 className="size-10 text-primary" />
        </div>
        <div>
          <p className="text-xl font-bold">Your answers are in</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Your teacher will watch your videos and mark them. You will get a notification with your score, and can then see the answer sheet.
          </p>
        </div>
        <Button variant="outline" onClick={() => setView("start")}>Done</Button>
      </div>
    )
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  if (view === "result" && result) {
    const missed = Math.max(1, correctNeeded(settings.passMark, result.total) - result.earned)
    return (
      <div className="flex flex-col items-center gap-5 py-8 px-4 text-center" aria-live="polite">
        <div className={cn("size-24 rounded-full flex items-center justify-center", result.passed ? "bg-emerald-100" : "bg-rose-100")}>
          {result.passed ? <Trophy className="size-12 text-emerald-600" /> : <XCircle className="size-12 text-rose-500" />}
        </div>
        <div>
          <p className="text-3xl font-black">{result.score}%</p>
          <p className="text-muted-foreground mt-1">{result.earned} / {result.total} marks</p>
        </div>
        <Badge variant="outline" className={cn("text-sm px-4 py-1", result.passed ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-rose-100 text-rose-700 border-rose-200")}>
          {result.passed ? "Passed" : `Not passed — need ${settings.passMark}%`}
        </Badge>
        {!result.passed && (
          <p className="text-sm text-muted-foreground max-w-sm">
            {missed === 1 ? "One more mark" : `${missed} more marks`} would have passed.
            {result.attemptsLeft === 0 && " You have no attempts left. Speak to your teacher if you need another go."}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={() => setView("start")}>Back</Button>
          {result.passed && nextHref && (
            <Button asChild><Link href={nextHref}>Continue <ChevronRight className="size-4 ml-1" /></Link></Button>
          )}
        </div>
      </div>
    )
  }

  // ── Looking back at the best go: each part's video, marks and answer sheet ─
  if (view === "review" && data.bestAttempt) {
    const best = data.bestAttempt
    return (
      <div className="flex flex-col gap-4 py-2">
        <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={() => setView("start")}>← Back</Button>
        {parts.map((p, i) => {
          const answer = best.answers.find((a) => a.questionId === p.id)
          return (
            <div key={p.id} className="rounded-xl border p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Part {i + 1} ({marksLabel(maxMarks(p))})</p>
                <MarksBadge question={asMarkQuestion(p)} answer={answer} />
              </div>
              {p.question && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{p.question}</p>}
              <AnswerAndModel question={asMarkQuestion(p)} answer={answer} />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Sitting it, one step at a time ────────────────────────────────────────
  if (view === "taking" && progress) {
    const at = Math.min(progress.step, steps.length - 1)
    const step = steps[at]
    const part = step.kind === "synopsis" ? null : parts[step.part]
    const isLast = at === steps.length - 1
    const left = progress.deadline ? (progress.deadline - now) / 1000 : 0
    const timeUp = progress.deadline != null && left <= 0
    const filmed = part ? progress.videos[part.id] : undefined
    const setVideo = (url: string | undefined) => setProgress((p) => {
      if (!p || !part) return p
      const videos = { ...p.videos }
      if (url) videos[part.id] = url
      else delete videos[part.id]
      return { ...p, videos }
    })
    const next = () => {
      if (step.kind === "answer" && !filmed && !timeUp &&
        !window.confirm("You haven't filmed your answers to this part. Carry on without them? You get 0 marks for it.")) return
      if (isLast) void submit(progress.videos)
      else goTo(at + 1)
    }

    return (
      <div ref={topRef} className="flex flex-col gap-5 py-2 scroll-mt-24">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{step.kind === "synopsis" ? "Before part 1" : `Part ${step.part + 1} of ${parts.length}`}</span>
            <span>Step {at + 1} of {steps.length}</span>
          </div>
          <Progress value={Math.round((at / steps.length) * 100)} className="h-1.5" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold flex items-center gap-2">
            {step.kind === "answer" ? <Camera className="size-5 text-primary" /> : <Eye className="size-5 text-primary" />}
            {STEP_NAME[step.kind]}
          </h3>
          {step.kind === "answer" && (
            <span className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
              timeUp ? "bg-rose-100 text-rose-700" : left < 60 ? "bg-amber-100 text-amber-800" : "bg-muted",
            )}>
              <Clock className="size-4" /> {timeUp ? "Time is up" : `${clock(left)} left`}
            </span>
          )}
        </div>

        {step.kind === "synopsis" && settings.storyUrl && (
          <WatchVideo key="synopsis" src={settings.storyUrl} controls={controls} onDone={() => setStepDone(true)} />
        )}
        {step.kind === "questions" && part?.questionsVideoUrl && (
          <>
            <WatchVideo key={`q-${part.id}`} src={part.questionsVideoUrl} controls={controls} onDone={() => setStepDone(true)} />
            <p className="text-sm text-muted-foreground">Next you watch part {step.part + 1} — look out for the answers.</p>
          </>
        )}
        {step.kind === "part" && part?.imageUrl && (
          <>
            {part.question && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">The questions</p>
                <p className="whitespace-pre-wrap">{part.question}</p>
              </div>
            )}
            <WatchVideo key={`p-${part.id}`} src={part.imageUrl} controls={controls} onDone={() => setStepDone(true)} />
          </>
        )}
        {step.kind === "answer" && part && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Turn on your camera and sign your answers to all of part {step.part + 1}&apos;s questions in one video.
              Recording stops by itself when the time is up.
            </p>
            {part.question && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">The questions</p>
                <p className="whitespace-pre-wrap">{part.question}</p>
              </div>
            )}
            {controls && part.questionsVideoUrl && (
              <details className="rounded-lg border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">Watch the questions again</summary>
                <ProtectedVideo src={part.questionsVideoUrl} controls playsInline className="mt-2 w-full max-h-72 rounded-lg bg-black" />
              </details>
            )}
            <SignAnswerRecorder
              key={part.id}
              lessonId={lessonId}
              videoUrl={filmed}
              onChange={setVideo}
              deadline={progress.deadline ?? undefined}
              timeUp={timeUp}
              filmLabel="Film your answers"
            />
            {timeUp && !filmed && (
              <p className="text-sm text-rose-700">Time is up and nothing was filmed for this part. Carry on to the next part.</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={next}
            disabled={submitting || (step.kind !== "answer" && !stepDone && !controls)}
          >
            {submitting
              ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Sending…</>
              : isLast
              ? "Send in my answers"
              : step.kind === "answer"
              ? <>Next part <ChevronRight className="size-4 ml-1" /></>
              : <>Next <ChevronRight className="size-4 ml-1" /></>}
          </Button>
        </div>
        {step.kind !== "answer" && !stepDone && !controls && (
          <p className="text-xs text-muted-foreground text-right -mt-3">You can go on once the video has finished.</p>
        )}
      </div>
    )
  }

  // ── Start: what happens, in order, and how it went before ─────────────────
  const best = data.bestAttempt
  const inProgress = !!progress && canAttempt && !pending
  const left = attemptsLeftText(data.attemptsLeft)
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn("size-16 rounded-full flex items-center justify-center", hasPassed ? "bg-emerald-100" : "bg-primary/10")}>
          {hasPassed ? <Trophy className="size-8 text-emerald-600" /> : <Clapperboard className="size-8 text-primary" />}
        </div>
        {best ? (
          <div>
            <p className="text-2xl font-black">{best.score}%</p>
            <p className="text-sm text-muted-foreground">
              {hasPassed ? "Passed — your best score" : `Your best score so far — you need ${settings.passMark}% to pass`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground max-w-md">
            Find a quiet place with good light, and allow your camera. Once you start, the steps come one after
            another, in this order. You have {settings.answerMinutes} minutes to film your answers to each part.
          </p>
        )}
      </div>

      {/* The order of the assessment, as on the DVD */}
      <ol className="rounded-xl border divide-y text-sm">
        {settings.storyUrl && <li className="flex items-center gap-2 px-4 py-2.5"><Eye className="size-4 text-muted-foreground" /> Watch the short synopsis</li>}
        {parts.map((p, i) => (
          <li key={p.id} className="px-4 py-2.5">
            <p className="font-semibold">Part {i + 1} <span className="font-normal text-muted-foreground">· {marksLabel(maxMarks(p))}</span></p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {p.questionsVideoUrl && <li className="flex items-center gap-2"><Eye className="size-3.5" /> Watch the questions</li>}
              <li className="flex items-center gap-2"><Eye className="size-3.5" /> Watch part {i + 1}</li>
              <li className="flex items-center gap-2"><Camera className="size-3.5" /> Film your answers · {settings.answerMinutes} minutes</li>
            </ul>
          </li>
        ))}
        <li className="flex items-center gap-2 px-4 py-2.5">
          <PenLine className="size-4 text-muted-foreground" />
          {settings.tutorMarks ? "Your teacher marks your videos" : "See the answer sheet and mark your own videos"}
        </li>
      </ol>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
        {[
          { label: "Marks", value: totalMarks },
          { label: "Pass mark", value: `${settings.passMark}%` },
          { label: "Attempts", value: settings.maxAttempts === null ? "Unlimited" : `${attempts.length} of ${settings.maxAttempts}` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border bg-muted/20 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {pending && (settings.tutorMarks ? (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-4 text-sm">
          <Hourglass className="size-5 text-primary shrink-0" />
          <p>Your answers are with your teacher to mark. You will get a notification with your score.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-center">
          <p className="text-sm text-amber-900">You sent in your answers but haven&apos;t marked them yet. Mark them against the answer sheet to get your score.</p>
          <Button onClick={() => setView("marking")}><PenLine className="size-4 mr-1.5" /> Mark your answers</Button>
        </div>
      ))}

      {!pending && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {inProgress ? (
            <>
              <Button onClick={() => { setView("taking"); setStepDone(false); setNow(Date.now()) }} disabled={!enrollmentId}>
                Carry on <ChevronRight className="size-4 ml-1" />
              </Button>
              <Button variant="outline" onClick={() => { if (window.confirm("Start again from the beginning? What you filmed is not kept.")) start() }} disabled={!enrollmentId}>
                <RotateCcw className="size-4 mr-1.5" /> Start again
              </Button>
            </>
          ) : canAttempt ? (
            <Button onClick={start} disabled={!enrollmentId} variant={hasPassed ? "outline" : "default"}>
              {attempts.length === 0 ? "Start the assessment" : <><RotateCcw className="size-4 mr-1.5" /> {hasPassed ? "Take it again" : "Try again"}</>}
            </Button>
          ) : !hasPassed && (
            <p className="text-sm text-muted-foreground">You have no attempts left. Speak to your teacher if you need another go.</p>
          )}
          {best && <Button variant="outline" onClick={() => setView("review")}>See marks and answer sheet</Button>}
        </div>
      )}

      {inProgress && (
        <p className="text-xs text-muted-foreground text-center">You are part-way through — step {Math.min(progress!.step, steps.length - 1) + 1} of {steps.length}.</p>
      )}
      {canAttempt && left && !hasPassed && <p className="text-xs text-muted-foreground text-center">{left}.</p>}
      {!enrollmentId && <p className="text-xs text-muted-foreground text-center">Enrol in this course to take this assessment.</p>}

      <AttemptHistory attempts={attempts} />
    </div>
  )
}
