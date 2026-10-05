"use client"

import { useState } from "react"
import {
  FlaskConical, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight, RotateCcw, Trophy, Loader2, Circle, History,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { isVideoMedia } from "@/lib/quiz"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Option = {
  id: string; text: string; imageUrl?: string | null; mediaType?: string | null; order: number
  /** Only sent once the student may see the correct answers. */
  isCorrect?: boolean
}
type Question = {
  id: string; question: string; imageUrl?: string | null; mediaType?: string | null; type: string; options: Option[]
}

type AttemptAnswer = { questionId: string; optionId: string | null; isCorrect: boolean }
type AttemptSummary = { id: string; score: number; passed: boolean; createdAt: string }

type QuizData = {
  questions: Question[]
  settings: { passMark: number; maxAttempts: number | null }
  /** Newest first. */
  attempts: AttemptSummary[]
  attemptsLeft: number | null
  answersRevealed: boolean
  bestAttempt: (AttemptSummary & { answers: AttemptAnswer[] }) | null
}

type Result = {
  score: number
  passed: boolean
  correct: number
  total: number
  passMark: number
  attemptsLeft: number | null
  answersRevealed: boolean
  questions: Question[]
  answers: AttemptAnswer[]
}

type Props = {
  lessonId: string
  enrollmentId: string | null
  onCompleted: () => void
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function attemptsLeftText(left: number | null) {
  if (left === null) return null
  return left === 0 ? "No attempts left" : `${left} attempt${left !== 1 ? "s" : ""} left`
}

// ─── Question media — image or video ──────────────────────────────────────────

function QuestionMedia({ question, className }: { question: Question; className?: string }) {
  if (!question.imageUrl) return null
  return isVideoMedia(question.imageUrl, question.mediaType)
    ? <ProtectedVideo src={question.imageUrl} autoPlay muted loop playsInline controls className={cn("rounded-xl border bg-black", className)} />
    : <img src={question.imageUrl} alt="question" className={cn("rounded-xl object-contain border", className)} />
}

// ─── Review — one attempt's answers, question by question ─────────────────────

function Review({ questions, answers, answersRevealed, onBack, onRetry }: {
  questions: Question[]
  answers: AttemptAnswer[]
  /** False while the test can still be retaken: only the student's own answers are marked. */
  answersRevealed: boolean
  onBack: () => void
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Review Answers</h3>
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
      </div>

      {!answersRevealed && (
        <p className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          You can see which of your answers were right. The correct answers are shown once you pass or have no attempts left.
        </p>
      )}

      {questions.map((q, i) => {
        const answer = answers.find((a) => a.questionId === q.id)
        return (
          <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              {answer?.isCorrect
                ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                : <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />}
              <div className="flex flex-col gap-2 flex-1">
                <p className="text-sm font-medium">{i + 1}. {q.question}</p>
                <QuestionMedia question={q} className="max-h-48 self-start" />
                {!answer?.optionId && <p className="text-xs text-rose-600">Not answered</p>}
              </div>
            </div>
            <div className={cn(
              "pl-6",
              q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1.5"
            )}>
              {q.options.map((opt) => {
                const isSelected = answer?.optionId === opt.id
                // Without the answer key, the student's own right answer is the only one known to be correct.
                const isCorrect = opt.isCorrect ?? (isSelected && !!answer?.isCorrect)
                const isVideo = isVideoMedia(opt.imageUrl, opt.mediaType)

                return (
                  <div
                    key={opt.id}
                    className={cn(
                      "rounded-lg border text-sm overflow-hidden",
                      opt.imageUrl ? "flex flex-col p-0" : "flex items-center gap-2 px-3 py-2",
                      isCorrect && "border-emerald-300 bg-emerald-50 text-emerald-800",
                      isSelected && !isCorrect && "border-rose-300 bg-rose-50 text-rose-800",
                      !isSelected && !isCorrect && "border-transparent text-muted-foreground"
                    )}
                  >
                    {opt.imageUrl && (
                      <div className="relative w-full">
                        {isVideo
                          ? <ProtectedVideo src={opt.imageUrl} autoPlay muted loop playsInline controls className="w-full aspect-video object-cover" />
                          : <img src={opt.imageUrl} alt={opt.text} className="w-full aspect-square object-cover" />}
                        {isCorrect && (
                          <span className="absolute top-1 right-1 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">✓ Correct</span>
                        )}
                        {isSelected && !isCorrect && (
                          <span className="absolute top-1 right-1 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">✗ Wrong</span>
                        )}
                      </div>
                    )}
                    <div className={cn("flex items-center gap-2 w-full", opt.imageUrl ? "px-2 py-1.5" : "")}>
                      {!opt.imageUrl && (isCorrect
                        ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        : isSelected
                          ? <XCircle className="size-3.5 shrink-0 text-rose-500" />
                          : <Circle className="size-3.5 shrink-0" />)}
                      {opt.text && <span className="text-xs">{opt.text}</span>}
                      {!opt.imageUrl && isCorrect && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Correct</span>}
                      {!opt.imageUrl && isSelected && !isCorrect && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-rose-600">Your answer</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        {onRetry && <Button onClick={onRetry}><RotateCcw className="size-4 mr-1.5" /> Try again</Button>}
      </div>
    </div>
  )
}

// ─── QuizTaker ────────────────────────────────────────────────────────────────

/**
 * A test as the student sits it: a start screen with the rules and their past
 * attempts, the questions one at a time, the result, and a review of the answers.
 */
export function QuizTaker({ lessonId, enrollmentId, onCompleted }: Props) {
  const { data, loading, refetch } = useFetch<QuizData>(`/api/student/lessons/${lessonId}/quiz`, {
    errorMessage: "Could not load this test",
  })

  const [view, setView] = useState<"start" | "taking" | "result" | "review-result" | "review-best">("start")
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  if (!data) {
    return loading
      ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      : <p className="text-sm text-muted-foreground text-center py-6">This test could not be loaded.</p>
  }

  const { questions, settings, attempts, bestAttempt } = data

  if (questions.length === 0) {
    return (
      <div className="text-center py-6">
        <FlaskConical className="size-10 text-primary mx-auto mb-2" />
        <p className="font-semibold">No questions yet</p>
        <p className="text-sm text-muted-foreground mt-1">The questions for this test haven&apos;t been added yet.</p>
      </div>
    )
  }

  const hasPassed = attempts.some((a) => a.passed)
  const canAttempt = data.attemptsLeft !== 0

  function start() {
    setSelected({})
    setCurrentIndex(0)
    setResult(null)
    setError(null)
    setView("taking")
  }

  async function submit() {
    if (!enrollmentId) return
    setSubmitting(true)
    setError(null)
    try {
      const answers = questions.map((q) => ({ questionId: q.id, optionId: selected[q.id] ?? "" }))
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, answers }),
      })
      const body = await res.json() as Omit<Result, "answers"> & { attempt: { answers: AttemptAnswer[] }; message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not submit your answers")
      setResult({ ...body, answers: body.attempt.answers })
      setView("result")
      if (body.passed) onCompleted()
      // Pick up the new attempt for the start screen.
      void refetch()
    } catch (e) {
      // The answers are still selected — nothing is lost, they can press Submit again.
      setError(e instanceof Error && e.message !== "Failed to fetch"
        ? e.message
        : "Could not submit your answers. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Results screen ────────────────────────────────────────────────────────
  if (view === "result" && result) {
    const left = attemptsLeftText(result.attemptsLeft)
    return (
      <div className="flex flex-col items-center gap-6 py-8 px-4 text-center">
        <div className={cn(
          "size-24 rounded-full flex items-center justify-center",
          result.passed ? "bg-emerald-100" : "bg-rose-100"
        )}>
          {result.passed
            ? <Trophy className="size-12 text-emerald-600" />
            : <XCircle className="size-12 text-rose-500" />}
        </div>

        <div>
          <p className="text-3xl font-black">{result.score}%</p>
          <p className="text-muted-foreground mt-1">
            {result.correct} / {result.total} correct
          </p>
        </div>

        <Badge
          className={cn(
            "text-sm px-4 py-1",
            result.passed
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : "bg-rose-100 text-rose-700 border-rose-200"
          )}
          variant="outline"
        >
          {result.passed ? "Passed" : `Not passed — need ${result.passMark}%`}
        </Badge>

        {!result.passed && left && (
          <p className="text-sm text-muted-foreground">
            {result.attemptsLeft === 0 ? "You have no attempts left. Speak to your teacher if you need another go." : left}
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setView("review-result")}>
            Review answers
          </Button>
          {!result.passed && result.attemptsLeft !== 0 && (
            <Button onClick={start}>
              <RotateCcw className="size-4 mr-1.5" /> Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── Review mode ───────────────────────────────────────────────────────────
  if (view === "review-result" && result) {
    return (
      <Review
        questions={result.questions}
        answers={result.answers}
        answersRevealed={result.answersRevealed}
        onBack={() => setView("result")}
        onRetry={!result.passed && result.attemptsLeft !== 0 ? start : undefined}
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
        onRetry={!hasPassed && canAttempt && enrollmentId ? start : undefined}
      />
    )
  }

  // ── Quiz taking ───────────────────────────────────────────────────────────
  if (view === "taking") {
    const q = questions[currentIndex]
    const answered = questions.filter((question) => selected[question.id]).length
    const progress = Math.round((answered / questions.length) * 100)

    return (
      <div className="flex flex-col gap-6 py-2">
        {/* Progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Question {currentIndex + 1} of {questions.length}</span>
            <span>{answered} answered</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Question */}
        {q && (
          <div className="rounded-xl border bg-muted/20 p-5 flex flex-col gap-4">
            <p className="font-semibold text-base leading-snug">{currentIndex + 1}. {q.question}</p>

            {/* Optional question image or video */}
            <QuestionMedia question={q} className="max-h-64 mx-auto" />

            {/* Options — grid layout when any option has an image */}
            <div className={cn(
              q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2"
            )}>
              {q.options.map((opt) => {
                const isSelected = selected[q.id] === opt.id
                const isVideo = isVideoMedia(opt.imageUrl, opt.mediaType)

                if (opt.imageUrl && isVideo) {
                  // ── Video option card — video is for watching only; text label selects
                  return (
                    <div
                      key={opt.id}
                      className={cn(
                        "rounded-xl border overflow-hidden flex flex-col transition-all",
                        isSelected ? "border-primary ring-2 ring-primary" : "border-border"
                      )}
                    >
                      <div className="relative">
                        <ProtectedVideo
                          src={opt.imageUrl}
                          autoPlay
                          muted
                          loop
                          playsInline
                          controls
                          className="w-full aspect-video object-cover"
                        />
                        {isSelected && (
                          <div className="absolute top-2 right-2 pointer-events-none">
                            <CheckCircle2 className="size-6 text-primary drop-shadow-md" />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelected((s) => ({ ...s, [q.id]: opt.id }))}
                        className={cn(
                          "px-3 py-2.5 text-xs font-medium text-center w-full transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-foreground hover:bg-muted"
                        )}
                      >
                        {opt.text || "Select this answer"}
                      </button>
                    </div>
                  )
                }

                if (opt.imageUrl) {
                  // ── Image option card
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelected((s) => ({ ...s, [q.id]: opt.id }))}
                      className={cn(
                        "rounded-xl border overflow-hidden flex flex-col transition-all",
                        isSelected
                          ? "border-primary ring-2 ring-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="relative">
                        <img src={opt.imageUrl} alt={opt.text} className="w-full aspect-square object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <CheckCircle2 className="size-8 text-primary drop-shadow" />
                          </div>
                        )}
                      </div>
                      {opt.text && (
                        <div className={cn(
                          "px-3 py-2 text-xs font-medium text-center",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                        )}>
                          {opt.text}
                        </div>
                      )}
                    </button>
                  )
                }

                // ── Text option row
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelected((s) => ({ ...s, [q.id]: opt.id }))}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-left transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border"
                    )}
                  >
                    <div className={cn(
                      "size-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                      isSelected ? "border-primary-foreground bg-primary-foreground" : "border-muted-foreground"
                    )}>
                      {isSelected && <div className="size-2 rounded-full bg-primary" />}
                    </div>
                    {opt.text}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline" size="sm"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="size-4 mr-1" /> Previous
          </Button>

          {currentIndex < questions.length - 1 ? (
            <Button
              size="sm"
              onClick={() => setCurrentIndex((i) => i + 1)}
              disabled={!selected[q?.id]}
            >
              Next <ChevronRight className="size-4 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={submit}
              disabled={answered < questions.length || submitting || !enrollmentId}
            >
              {submitting
                ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Submitting…</>
                : "Submit Test"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── Start screen — the rules, and how previous attempts went ───────────────
  const left = attemptsLeftText(data.attemptsLeft)
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn(
          "size-16 rounded-full flex items-center justify-center",
          hasPassed ? "bg-emerald-100" : "bg-primary/10"
        )}>
          {hasPassed
            ? <Trophy className="size-8 text-emerald-600" />
            : <FlaskConical className="size-8 text-primary" />}
        </div>
        {bestAttempt ? (
          <div>
            <p className="text-2xl font-black">{bestAttempt.score}%</p>
            <p className="text-sm text-muted-foreground">
              {hasPassed ? "Passed — your best score" : `Your best score so far — you need ${settings.passMark}% to pass`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground max-w-sm">
            Answer every question, then submit. You can go back and change an answer before you submit.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Questions", value: questions.length },
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
          <Button onClick={start} disabled={!enrollmentId} variant={hasPassed ? "outline" : "default"}>
            {attempts.length === 0
              ? "Start Test"
              : <><RotateCcw className="size-4 mr-1.5" /> {hasPassed ? "Take it again" : "Try again"}</>}
          </Button>
        ) : !hasPassed && (
          <p className="text-sm text-muted-foreground">
            You have no attempts left. Speak to your teacher if you need another go.
          </p>
        )}
        {bestAttempt && (
          <Button variant="outline" onClick={() => setView("review-best")}>Review answers</Button>
        )}
      </div>

      {canAttempt && left && attempts.length > 0 && !hasPassed && (
        <p className="text-xs text-muted-foreground text-center">{left}</p>
      )}

      {!enrollmentId && (
        <p className="text-xs text-muted-foreground text-center">Enrol in this course to take this test.</p>
      )}

      {/* Past attempts */}
      {attempts.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <History className="size-3.5" /> Your attempts
          </p>
          <div className="rounded-xl border divide-y">
            {attempts.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">
                  Attempt {attempts.length - i} · {shortDate(a.createdAt)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{a.score}%</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      a.passed
                        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                        : "bg-rose-100 text-rose-700 border-rose-200"
                    )}
                  >
                    {a.passed ? "Passed" : "Not passed"}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
