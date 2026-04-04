"use client"

import { useState } from "react"
import {
  FlaskConical, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight, RotateCcw, Trophy, Loader2, Circle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Option = { id: string; text: string; imageUrl?: string | null; mediaType?: string | null; order: number }

function isVideoUrl(url: string | null | undefined, mediaType?: string | null): boolean {
  if (mediaType === "video") return true
  if (!url) return false
  return /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url)
}
type Question = { id: string; question: string; imageUrl?: string | null; type: string; options: Option[] }

type AttemptAnswer = { questionId: string; optionId: string | null; isCorrect: boolean }
type BestAttempt = { score: number; passed: boolean; answers: AttemptAnswer[] } | null

type ResultOption = Option & { isCorrect: boolean }
type ResultQuestion = Question & { options: ResultOption[] }

type Props = {
  lessonId: string
  enrollmentId: string | null
  questions: Question[]
  bestAttempt: BestAttempt
  onCompleted: () => void
}

// ─── QuizTaker ────────────────────────────────────────────────────────────────

export function QuizTaker({ lessonId, enrollmentId, questions, bestAttempt, onCompleted }: Props) {
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    score: number
    passed: boolean
    correct: number
    total: number
    questions: ResultQuestion[]
    answers: AttemptAnswer[]
  } | null>(null)
  const [reviewMode, setReviewMode] = useState(false)

  const q = questions[currentIndex]
  const answered = Object.keys(selected).length
  const progress = Math.round((answered / questions.length) * 100)

  async function submit() {
    if (!enrollmentId) return
    setSubmitting(true)
    try {
      const answers = questions.map((q) => ({ questionId: q.id, optionId: selected[q.id] ?? "" }))
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, answers }),
      })
      const data = await res.json() as {
        score: number; passed: boolean; correct: number; total: number
        questions: ResultQuestion[]; attempt: { answers: AttemptAnswer[] }
      }
      setResult({ ...data, answers: data.attempt.answers })
      if (data.passed) onCompleted()
    } finally {
      setSubmitting(false)
    }
  }

  function retry() {
    setSelected({})
    setCurrentIndex(0)
    setResult(null)
    setReviewMode(false)
  }

  // ── Results screen ────────────────────────────────────────────────────────
  if (result && !reviewMode) {
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
          {result.passed ? "Passed" : "Not passed — need 70%"}
        </Badge>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setReviewMode(true)}>
            Review answers
          </Button>
          {!result.passed && (
            <Button onClick={retry}>
              <RotateCcw className="size-4 mr-1.5" /> Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── Review mode ───────────────────────────────────────────────────────────
  if (result && reviewMode) {
    return (
      <div className="flex flex-col gap-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Review Answers</h3>
          <Button variant="outline" size="sm" onClick={() => setReviewMode(false)}>
            Back to results
          </Button>
        </div>

        {result.questions.map((q, i) => {
          const answer = result.answers.find((a) => a.questionId === q.id)
          return (
            <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
              <div className="flex items-start gap-2">
                {answer?.isCorrect
                  ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />}
                <div className="flex flex-col gap-2 flex-1">
                  <p className="text-sm font-medium">{i + 1}. {q.question}</p>
                  {q.imageUrl && (
                    <img src={q.imageUrl} alt="question" className="rounded-lg max-h-48 object-contain border" />
                  )}
                </div>
              </div>
              <div className={cn(
                "pl-6",
                q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1.5"
              )}>
                {q.options.map((opt) => {
                  const isSelected = answer?.optionId === opt.id
                  const isCorrect = opt.isCorrect
                  const isVideo = isVideoUrl(opt.imageUrl, opt.mediaType)

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
                            ? <video src={opt.imageUrl} autoPlay muted loop playsInline controls className="w-full aspect-video object-cover" />
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
          <Button variant="outline" onClick={() => setReviewMode(false)}>Back to results</Button>
          {!result.passed && <Button onClick={retry}><RotateCcw className="size-4 mr-1.5" /> Try again</Button>}
        </div>
      </div>
    )
  }

  // ── Best attempt banner ───────────────────────────────────────────────────
  // ── Quiz taking ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Best attempt banner */}
      {bestAttempt && (
        <div className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
          bestAttempt.passed ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
        )}>
          {bestAttempt.passed
            ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
            : <FlaskConical className="size-4 text-amber-500 shrink-0" />}
          <p>
            Best score: <strong>{bestAttempt.score}%</strong>
            {bestAttempt.passed ? " — Passed!" : " — Retake to improve."}
          </p>
        </div>
      )}

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

          {/* Optional question image */}
          {q.imageUrl && (
            <img
              src={q.imageUrl}
              alt="question"
              className="rounded-xl max-h-64 object-contain border mx-auto"
            />
          )}

          {/* Options — grid layout when any option has an image */}
          <div className={cn(
            q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2"
          )}>
            {q.options.map((opt) => {
              const isSelected = selected[q.id] === opt.id
              const isVideo = isVideoUrl(opt.imageUrl, opt.mediaType)

              if (opt.imageUrl && isVideo) {
                // ── Video option card
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelected((s) => ({ ...s, [q.id]: opt.id }))}
                    className={cn(
                      "rounded-xl border overflow-hidden flex flex-col transition-all text-left",
                      isSelected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className="relative">
                      <video
                        src={opt.imageUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        controls
                        className="w-full aspect-video object-cover"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {isSelected && (
                        <div className="absolute top-2 right-2 pointer-events-none">
                          <CheckCircle2 className="size-6 text-primary drop-shadow-md" />
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
              : "Submit Quiz"}
          </Button>
        )}
      </div>

      {!enrollmentId && (
        <p className="text-xs text-muted-foreground text-center">Enrol in this course to submit your answers.</p>
      )}
    </div>
  )
}
