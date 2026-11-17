"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, RotateCcw, Trophy, Loader2, Timer, Keyboard, Hand, PenLine, Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { attemptScore, newOrder, picksWords, signsWords, type MarkingTest, type SignQuestion, type VocabularyMode } from "@/lib/quiz"
import type { HighScore } from "@/lib/quiz-high-scores"
import { cn } from "@/lib/utils"
import { AttemptHistory, attemptsLeftText, type AttemptSummary } from "./AttemptHistory"
import { SignAnswerRecorder } from "./SignAnswerRecorder"
import { MarkAnswers, type MarkQuestion } from "./SelfMarking"
import { useTopOnNewScreen } from "./TestTop"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignAnswer = {
  questionId: string
  answerText: string | null
  /** The word picked, or typed, was right. */
  isCorrect: boolean
  /** Vocabulary signed: the student's recording of the word, and the tick (1) or cross (0) it got. */
  videoUrl?: string | null
  marks?: number | null
  markedByTutor?: boolean
}

export type SignTestData = {
  questions: SignQuestion[]
  settings: {
    passMark: number
    maxAttempts: number | null
    kind: "FINGERSPELLING" | "VOCABULARY"
    answerSeconds: number
    /** How many times each sign plays; null (or absent) = repeats until the time is up. */
    signPlays?: number | null
    /** Vocabulary: sign → word, word → sign, or both. */
    vocabularyMode?: VocabularyMode
  }
  /** Newest first. */
  attempts: AttemptSummary[]
  attemptsLeft: number | null
  answersRevealed: boolean
  bestAttempt: (AttemptSummary & { answers: SignAnswer[] }) | null
  /** Submitted, with the words signed still to be marked by the student. */
  pendingAttempt?: (AttemptSummary & { answers: SignAnswer[] }) | null
  /** Fingerspelling only. */
  highScores?: HighScore[]
}

type Result = {
  attemptId: string
  /** False until the student has marked the words they signed. */
  selfMarked: boolean
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

// The clock starts once the sign has been watched to its end — the last play
// when the plays are limited, the first when it repeats — so neither a slow
// connection nor the length of the word eats into the time. This starts it
// anyway if the video never gets there (it stalls, or autoplay is blocked).
const VIDEO_WAIT_MS = 45_000

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
  /** Plays of the video before it is hidden; null = it repeats until the time is up. */
  plays?: number | null
  number: number
  total: number
  /** Called once: with the word given, or whatever was typed when the time ran out. */
  onAnswer: (text: string) => void
  /** Shown under the sign on a wide screen. */
  aside?: React.ReactNode
}) {
  const totalMs = answerSeconds * 1000
  // Whether the clock is running. Vocabulary: straight away, the words are already there to pick.
  // Fingerspelling: from the end of the sign (see VIDEO_WAIT_MS), since the word is still being spelled.
  const [ready, setReady] = useState(kind === "VOCABULARY")
  // A test set to play each sign once or twice: which play this is, and
  // whether they are used up (the video is then hidden).
  const [play, setPlay] = useState(1)
  const [playsUsed, setPlaysUsed] = useState(false)
  // A phone can refuse to start the video by itself (battery or data saver,
  // a browser setting), leaving it stuck on its first frame. A tap starts it.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
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

  function startVideo() {
    const v = videoRef.current
    if (!v) return
    v.play().then(
      () => setBlocked(false),
      (err: unknown) => {
        // AbortError only means the load was restarted; that play is retried.
        if (err instanceof DOMException && err.name === "NotAllowedError") setBlocked(true)
      }
    )
  }

  // `autoPlay` alone is not enough on some phones: ask for it, and hear back.
  useEffect(startVideo, [])

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
      <p className="flex items-center justify-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
        <Timer className="size-3.5" /> Timer
      </p>
      <p className="text-4xl font-black tabular-nums leading-tight" role="timer" aria-label={`${secondsLeft} seconds left`}>
        {secondsLeft}
      </p>
      {!ready && <p className="text-[0.6875rem] text-muted-foreground">Starts when the sign ends</p>}
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
      className="w-full aspect-video max-h-[60vh] rounded-xl border bg-black object-contain select-none pointer-events-none"
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
    />
  ) : sign.imageUrl && (
    <div className="relative">
      <ProtectedVideo
        ref={videoRef}
        src={sign.imageUrl}
        autoPlay muted playsInline
        onPlaying={() => setBlocked(false)}
        onError={() => setReady(true)}
        // Not looped with the attribute: a looping video never says it has ended.
        onEnded={(e) => {
          const v = e.currentTarget
          const replay = () => {
            v.currentTime = 0
            startVideo()
          }
          if (!plays) {
            setReady(true)
            replay()
          } else if (play < plays) {
            replay()
            setPlay(play + 1)
          } else {
            setReady(true)
            setPlaysUsed(true)
          }
        }}
        // No scrubbing back when the plays are limited — that would be a replay.
        controls={false}
        className="w-full aspect-video max-h-[60vh] rounded-xl border bg-black object-contain"
      />
      {blocked && !playsUsed && (
        <button
          type="button"
          onClick={startVideo}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/50 text-white"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-primary shadow-lg">
            <Play className="size-8 fill-current" />
          </span>
          <span className="text-base font-semibold">Tap to play</span>
        </button>
      )}
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
      {/* The timer sits beside the progress, above the sign, so the sign gets the full width. */}
      <div className="flex items-end gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Sign {number} of {total}</p>
          <Progress value={((number - 1) / total) * 100} className="h-1.5" />
        </div>
        <div className="w-36 shrink-0 sm:w-44">{timer}</div>
      </div>

      <div className="flex flex-col gap-4">
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
          // On a computer the sign takes most of the width so it is easy to read.
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)_minmax(8rem,11rem)] sm:items-center">
            <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">{video}</div>
            <div className="flex flex-col gap-3 sm:col-start-1 sm:row-start-1">{choices.slice(0, half).map(choiceButton)}</div>
            <div className="flex flex-col gap-3 sm:col-start-3 sm:row-start-1">{choices.slice(half).map(choiceButton)}</div>
          </div>
        )}

        {aside}
      </div>
    </div>
  )
}

// ─── 3, 2, 1 — so the first sign does not catch anyone out ────────────────────

export function GetReady({ onDone, label = "Get ready" }: { onDone: () => void; label?: string }) {
  const [count, setCount] = useState(3)
  useEffect(() => {
    const tick = setTimeout(() => (count > 1 ? setCount(count - 1) : onDone()), 800)
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center" aria-live="assertive">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p key={count} className="text-7xl font-black text-primary tabular-nums animate-in zoom-in-50 duration-300">{count}</p>
    </div>
  )
}

// ─── Word → sign: how it works, before starting ──────────────────────────────

function SignItInstructions({ picks, timed }: { picks: boolean; timed: string }) {
  const steps = [
    { title: "Read the word", text: "Look carefully at the word shown on the screen." },
    { title: "Record your answer", text: "Sign the word clearly and accurately before moving on to the next question." },
    ...(picks ? [{ title: "Pick the words", text: `Then watch each sign and pick the right word.${timed}` }] : []),
    { title: "Mark your own test", text: "After completing the test, you will see the correct answers to check your work." },
    { title: "Check your signs", text: "Compare your recorded signs with the video answers." },
  ]
  return (
    <div className="mx-auto w-full max-w-md flex flex-col gap-3 text-left">
      <ol className="flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 text-sm">
            <span className="size-6 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
            <span><span className="font-semibold">{s.title}:</span> <span className="text-muted-foreground">{s.text}</span></span>
          </li>
        ))}
      </ol>
      <div className="ml-9 flex flex-col gap-1 text-sm">
        <p className="flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span><span className="font-semibold">Correct:</span> <span className="text-muted-foreground">tick it if your sign matches the correct answer.</span></span>
        </p>
        <p className="flex items-center gap-2">
          <XCircle className="size-4 shrink-0 text-rose-500" />
          <span><span className="font-semibold">Incorrect:</span> <span className="text-muted-foreground">put a cross if it does not match.</span></span>
        </p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Important reminder</p>
        <p className="mt-0.5">
          Please be honest when marking your own work. Do not give yourself a mark if your sign is incorrect.
          Your teacher can see your recordings and marks.
        </p>
      </div>
    </div>
  )
}

// ─── One word to sign — not against the clock ─────────────────────────────────

/**
 * Vocabulary, word → sign: the word, and the camera to film yourself signing
 * it. The student moves on once they have a recording, or skips the word.
 */
function SignItRound({ lessonId, sign, number, total, videoUrl, onVideo, onNext }: {
  lessonId: string
  sign: SignQuestion
  number: number
  total: number
  videoUrl?: string
  onVideo: (videoUrl: string | undefined) => void
  onNext: () => void
}) {
  const last = number === total
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Word {number} of {total}</p>
        <Progress value={((number - 1) / total) * 100} className="h-1.5" />
      </div>

      <div className="rounded-xl border bg-muted/20 px-4 py-6 text-center">
        <p className="text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">Sign this word</p>
        <p className="mt-1 text-4xl font-black break-words">{sign.word}</p>
      </div>

      <SignAnswerRecorder key={sign.id} lessonId={lessonId} videoUrl={videoUrl} onChange={onVideo} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onNext} disabled={!videoUrl}>
          {last ? "Done" : "Next word"} <ChevronRight className="size-4 ml-1" />
        </Button>
        {!videoUrl && (
          <button type="button" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onNext}>
            Skip this word
          </button>
        )}
      </div>
    </div>
  )
}

/** The words signed, as the marking screen takes them: the word is the question, its sign the model. */
function toMark(questions: SignQuestion[]): MarkQuestion[] {
  return questions.map((q) => ({
    id: q.id, question: q.word ?? "", type: "SIGN", answerVideoUrl: q.imageUrl, answerMediaType: q.mediaType,
  }))
}

// ─── Review — what was answered for each sign ─────────────────────────────────

/** A sign's clip, or its picture. */
function SignMedia({ sign }: { sign: SignQuestion }) {
  if (!sign.imageUrl) return null
  return sign.mediaType === "image"
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={sign.imageUrl} alt="" className="w-full aspect-video rounded-lg bg-black object-contain" draggable={false} />
    : <ProtectedVideo src={sign.imageUrl} muted loop playsInline controls className="w-full aspect-video rounded-lg bg-black object-contain" />
}

export function Review({ questions, answers, answersRevealed, onBack, test }: {
  questions: SignQuestion[]
  answers: SignAnswer[]
  /** False while the test can still be retaken: the words that were missed stay hidden. */
  answersRevealed: boolean
  onBack: () => void
  /** A vocabulary test: which way round it went. Left out, words were picked or typed. */
  test?: MarkingTest
}) {
  const signs = !!test && signsWords(test)
  const picks = !test || !signs || picksWords(test)
  const right = answers.filter((a) => a.isCorrect).length
  // Signing a word earns a mark too, so the score is in marks.
  const marks = test && signs ? attemptScore(questions.map((q) => ({ id: q.id, type: "SIGN" })), answers, test) : null
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold">Review Answers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {marks ? `${marks.earned} of ${marks.total} marks` : `${right} of ${questions.length} correct`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4 mr-1" /> Back
        </Button>
      </div>

      {picks && !answersRevealed && (
        <p className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          You can see which of your answers were right. The words you missed are shown once you pass or have no attempts left.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => {
          const answer = answers.find((a) => a.questionId === q.id)
          // A sign added after this attempt was never put to the student.
          if (!answer) return null
          const allRight = (!picks || answer.isCorrect) && (!signs || answer.marks === 1)
          // Picking is the test of which word a sign is: the word shows once it may.
          const word = picks ? q.answer : q.word
          return (
            <div
              key={q.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3",
                allRight ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
              )}
            >
              {signs && word && <p className="font-semibold break-words">{word}</p>}
              {signs && <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-600">The sign</p>}
              <SignMedia sign={q} />
              {picks && (
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
              )}
              {signs && (
                <div className="flex flex-col gap-1.5">
                  <p className="flex items-start gap-2 text-sm font-medium">
                    {answer.marks === 1
                      ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                      : <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />}
                    <span>
                      {answer.marks === 1 ? "Your signing matched" : answer.marks === 0 ? (answer.videoUrl ? "Your signing didn't match" : "Not signed") : "Not marked yet"}
                      {answer.markedByTutor && <span className="font-normal text-muted-foreground"> · marked by your teacher</span>}
                    </span>
                  </p>
                  {answer.videoUrl && (
                    <ProtectedVideo src={answer.videoUrl} controls playsInline muted className="w-full aspect-video rounded-lg border bg-black" />
                  )}
                </div>
              )}
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
 *
 * A vocabulary test can also go word → sign: each word comes up to film
 * yourself signing, with no clock. Done both ways round, the words are signed
 * first, then the signs are played to pick the words. The signing is marked by
 * the student once they have sent it, against each sign, before their score.
 */
export function SignTestTaker({ lessonId, enrollmentId, data, refetch, onCompleted, nextHref }: Props) {
  const { questions, settings, attempts, bestAttempt, highScores } = data
  const fingerspelling = settings.kind === "FINGERSPELLING"
  const test: MarkingTest = { testKind: settings.kind, vocabularyMode: settings.vocabularyMode }
  const signs = signsWords(test)
  const picks = fingerspelling || picksWords(test)

  const [view, setView] = useState<
    "start" | "signing" | "ready" | "playing" | "sending" | "marking" | "result" | "review-result" | "review-best"
  >("start")
  // The signs of this go, in the order they come up — a new order each time.
  const [round, setRound] = useState<SignQuestion[]>([])
  const [index, setIndex] = useState(0)
  // Vocabulary signed: the recording made of each word.
  const [videos, setVideos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const answersRef = useRef<Record<string, string>>({})
  const startedAtRef = useRef(0)
  const tookMsRef = useRef(0)
  useTopOnNewScreen(view)

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
  const pending = data.pendingAttempt ?? null

  function start() {
    answersRef.current = {}
    tookMsRef.current = 0
    setVideos({})
    setRound(newOrder(questions, round))
    setIndex(0)
    setResult(null)
    setError(null)
    setView(signs ? "signing" : "ready")
  }

  async function send() {
    setView("sending")
    setError(null)
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: round.map((q) => ({ questionId: q.id, text: answersRef.current[q.id] ?? "", videoUrl: videos[q.id] })),
          durationMs: tookMsRef.current || undefined,
        }),
      })
      const body = await res.json() as Omit<Result, "answers" | "attemptId"> & { attempt: { id: string; answers: SignAnswer[] }; message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not send your answers")
      setResult({ ...body, attemptId: body.attempt.id, answers: body.attempt.answers })
      // The words signed are marked by the student before the score.
      setView(body.selfMarked ? "result" : "marking")
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

  // The last word signed: on to picking the words, both ways round, or done.
  function signed() {
    if (index + 1 < round.length) {
      setIndex(index + 1)
      return
    }
    if (picks) {
      // Picking the words, in a different order from signing them.
      setRound(newOrder(round, round))
      setIndex(0)
      setView("ready")
    } else {
      void send()
    }
  }

  if (view === "signing" && round[index]) {
    return (
      <SignItRound
        lessonId={lessonId}
        sign={round[index]}
        number={index + 1}
        total={round.length}
        videoUrl={videos[round[index].id]}
        onVideo={(url) => setVideos((v) => {
          const next = { ...v }
          if (url) next[round[index].id] = url
          else delete next[round[index].id]
          return next
        })}
        onNext={signed}
      />
    )
  }

  if (view === "ready") {
    return (
      <GetReady
        label={signs ? "Now watch each sign and pick its word" : undefined}
        onDone={() => { startedAtRef.current = Date.now(); setView("playing") }}
      />
    )
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

  // ── Marking the words signed — straight after sending, or coming back to it ──
  if (view === "marking") {
    const marking = result && !result.selfMarked
      ? { attemptId: result.attemptId, questions: result.questions, answers: result.answers }
      : pending && { attemptId: pending.id, questions, answers: pending.answers }
    if (marking) {
      return (
        <MarkAnswers
          lessonId={lessonId}
          attemptId={marking.attemptId}
          questions={toMark(marking.questions)}
          answers={marking.answers}
          onMarked={(marked, marks) => {
            setResult({
              attemptId: marking.attemptId,
              selfMarked: true,
              score: marked.score,
              passed: marked.passed,
              correct: marked.earned,
              total: marked.total,
              passMark: result?.passMark ?? settings.passMark,
              attemptsLeft: marked.attemptsLeft,
              answersRevealed: result?.answersRevealed ?? data.answersRevealed,
              questions: marking.questions,
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
            {result.correct} / {result.total} {signs ? "marks" : "correct"}
            {tookMsRef.current > 0 && ` · ${seconds(tookMsRef.current)}`}
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
        test={test}
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
        test={test}
      />
    )
  }

  // ── Start screen — how it is played, and how previous goes went ────────────
  const left = attemptsLeftText(data.attemptsLeft)
  const Icon = fingerspelling ? Keyboard : Hand
  const timed = ` When each one finishes you have ${settings.answerSeconds} seconds, then the next comes up.`
    + (settings.signPlays === 1 ? " Each one is shown once only — watch closely!" : settings.signPlays === 2 ? " Each one is shown twice." : "")
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
        {!signs && (
          <p className="text-sm text-muted-foreground max-w-sm">
            {fingerspelling
              ? `Watch each word being fingerspelled and type it.${timed}`
              : `Watch each sign and pick the right word.${timed}`}
          </p>
        )}
      </div>

      {signs && <SignItInstructions picks={picks} timed={timed} />}

      <div className={cn("grid grid-cols-2 gap-2 sm:gap-3 text-center", picks ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        {[
          { label: signs && !picks ? "Words" : "Signs", value: questions.length },
          ...(picks ? [{ label: "Time each", value: `${settings.answerSeconds} sec` }] : []),
          { label: "Pass mark", value: `${settings.passMark}%` },
          {
            label: "Attempts",
            value: settings.maxAttempts === null ? "Unlimited" : `${attempts.length} of ${settings.maxAttempts}`,
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border bg-muted/20 px-3 py-3">
            <p className="text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {pending ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-center">
          <p className="text-sm text-amber-900">
            You sent this test but haven&apos;t marked your signing yet. Mark it to get your score.
          </p>
          <Button onClick={() => setView("marking")}>
            <PenLine className="size-4 mr-1.5" /> Mark your signing
          </Button>
        </div>
      ) : (
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
      )}

      {canAttempt && !pending && left && (
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
