"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  FlaskConical, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight, RotateCcw, Trophy, Loader2, Circle, LogOut, BookOpen, Check, PenLine,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { attemptScore, chosenOptionIds, correctNeeded, isSelfMarked, isSignTest, isVideoMedia, maxMarks, type TestKind } from "@/lib/quiz"
import { AttemptHistory, attemptsLeftText, type AttemptSummary } from "./AttemptHistory"
import { SignTestTaker, type SignTestData } from "./SignTestTaker"
import { SignAnswerRecorder } from "./SignAnswerRecorder"
import { AnswerAndModel, MarkAnswers, MarksBadge, questionText } from "./SelfMarking"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Option = {
  id: string; text: string; imageUrl?: string | null; mediaType?: string | null; order: number
  /** Only sent once the student may see the correct answers. */
  isCorrect?: boolean
}
type Question = {
  id: string; question: string; imageUrl?: string | null; mediaType?: string | null; type: string; options: Option[]
  /** The student may pause and rewind the question's videos while taking the test. */
  videoControls?: boolean
  /** The question and answers appear only once the question's video has ended. */
  questionAfterVideo?: boolean
  /** More than one answer is correct: the student ticks every one. */
  multiple?: boolean
  /** WRITTEN: what it is worth; null = 3. */
  maxMarks?: number | null
  /** WRITTEN: the model answer — sent once the student has submitted, to mark themselves against. */
  modelAnswer?: string | null
  /** SIGN: the sign done right — likewise only after submitting. */
  answerVideoUrl?: string | null
}

type AttemptAnswer = {
  questionId: string; optionId: string | null; optionIds?: string[]; isCorrect: boolean
  /** WRITTEN: what the student wrote. */
  answerText?: string | null
  /** SIGN: the student's recording; gone once the course is archived. */
  videoUrl?: string | null
  /** WRITTEN / SIGN: the marks given; null until the student has marked it. */
  marks?: number | null
  markedByTutor?: boolean
}

type QuizData = {
  questions: Question[]
  settings: {
    passMark: number
    maxAttempts: number | null
    kind: TestKind
    /** Story tests: the video the questions are about. */
    storyUrl: string | null
    /** Story tests: the student may pause, rewind and skip the story. */
    storyControls?: boolean
  }
  /** Newest first. */
  attempts: AttemptSummary[]
  attemptsLeft: number | null
  answersRevealed: boolean
  bestAttempt: (AttemptSummary & { answers: AttemptAnswer[] }) | null
  /** Submitted, with written or signed answers the student has still to mark. */
  pendingAttempt: (AttemptSummary & { answers: AttemptAnswer[] }) | null
}

type Result = {
  attemptId: string
  /** False until the student has marked their written and signed answers. */
  selfMarked: boolean
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
  /** Where "Continue" goes once the test is passed — the next lesson, if there is one. */
  nextHref?: string
}

// ─── Answers in progress ──────────────────────────────────────────────────────
// Kept on the device while a test is being sat, so a refresh, a dropped
// connection or opening another page does not throw the answers away. Keyed by
// enrolment as well as test, so two students sharing a computer never see each
// other's.

/**
 * The options ticked on each question — one, or several where more than one is
 * correct — and the written answers and recordings made so far.
 */
type Draft = { selected: Record<string, string[]>; texts: Record<string, string>; videos: Record<string, string>; currentIndex: number }

const stringsOnly = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {}

function draftKey(lessonId: string, enrollmentId: string | null) {
  return `bls-test-draft:${enrollmentId ?? "preview"}:${lessonId}`
}

function readDraft(key: string): Draft | null {
  try {
    const draft = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<Draft> | null
    if (!draft || typeof draft.selected !== "object" || draft.selected === null) return null
    // A draft kept before questions could have several answers holds one id per question.
    const selected = Object.fromEntries(
      Object.entries(draft.selected as Record<string, unknown>).map(([q, ids]) => [
        q, (Array.isArray(ids) ? ids : [ids]).filter((id): id is string => typeof id === "string"),
      ])
    )
    return { selected, texts: stringsOnly(draft.texts), videos: stringsOnly(draft.videos), currentIndex: Number(draft.currentIndex) || 0 }
  } catch {
    return null
  }
}

function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft))
    else window.localStorage.removeItem(key)
  } catch {
    // Private browsing or a full disk — the test still works, it just is not kept.
  }
}

// ─── Question media — image or video ──────────────────────────────────────────

// While the test is being taken a video only has controls when the test's
// author allowed them; looking back over the results it always has them.
// With `onEnded` the video plays once instead of looping, so it can end; a tap
// starts it where the browser wouldn't autoplay and there are no controls.
function QuestionMedia({ question, className, controls = true, onEnded }: {
  question: Question; className?: string; controls?: boolean; onEnded?: () => void
}) {
  if (!question.imageUrl) return null
  return isVideoMedia(question.imageUrl, question.mediaType)
    ? <ProtectedVideo
        src={question.imageUrl} autoPlay muted loop={!onEnded} playsInline controls={controls}
        onEnded={onEnded}
        onClick={(e) => {
          const video = e.currentTarget
          if (!controls && video.paused && !video.ended) void video.play().catch(() => {})
        }}
        className={cn("rounded-xl border bg-black", className)}
      />
    : <img src={question.imageUrl} alt="question" className={cn("rounded-xl object-contain border", className)} />
}

// A story without controls plays straight through: it starts by itself, muted
// (browsers only start silent video unasked — a signed story needs no sound),
// and a tap can start it where the browser wouldn't, but never pause it.
function StoryVideo({ src, controls, autoPlay, className }: { src: string; controls: boolean; autoPlay?: boolean; className?: string }) {
  return (
    <ProtectedVideo
      src={src}
      playsInline
      controls={controls}
      autoPlay={autoPlay || !controls}
      muted={!controls}
      onClick={(e) => {
        const video = e.currentTarget
        if (!controls && video.paused && !video.ended) void video.play().catch(() => {})
      }}
      className={className}
    />
  )
}

/** Answers side by side when they are pictures; one per row on a phone when they are videos, to keep them watchable. */
function optionsLayout(q: Question, gridGap: string, listGap: string) {
  if (q.options.some((o) => isVideoMedia(o.imageUrl, o.mediaType))) return cn("grid grid-cols-1 sm:grid-cols-2", gridGap)
  if (q.options.some((o) => o.imageUrl)) return cn("grid grid-cols-2", gridGap)
  return cn("flex flex-col", listGap)
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
  const [wrongOnly, setWrongOnly] = useState(false)
  const isRight = (q: Question) => !!answers.find((a) => a.questionId === q.id)?.isCorrect
  const right = questions.filter(isRight).length
  const wrong = questions.length - right
  // With written answers (worth more than 1) the score is in marks, not questions
  // right. Story tests are marked as Questions tests are.
  const marks = questions.some((q) => isSelfMarked(q.type)) ? attemptScore(questions, answers, { testKind: "STANDARD" }) : null

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

      {wrong > 0 && right > 0 && (
        <div className="flex gap-2" role="group" aria-label="Which questions to show">
          <Button size="sm" variant={wrongOnly ? "outline" : "default"} aria-pressed={!wrongOnly} onClick={() => setWrongOnly(false)}>
            All ({questions.length})
          </Button>
          <Button size="sm" variant={wrongOnly ? "default" : "outline"} aria-pressed={wrongOnly} onClick={() => setWrongOnly(true)}>
            To work on ({wrong})
          </Button>
        </div>
      )}

      {!answersRevealed && (
        <p className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          You can see which of your answers were right. The correct answers are shown once you pass or have no attempts left.
        </p>
      )}

      {questions.map((q, i) => {
        const answer = answers.find((a) => a.questionId === q.id)
        if (wrongOnly && answer?.isCorrect) return null
        return (
          <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              {answer?.isCorrect
                ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                : <XCircle className={cn("size-4 shrink-0 mt-0.5", answer?.marks ? "text-amber-500" : "text-rose-500")} />}
              <div className="flex flex-col gap-2 flex-1">
                <p className="text-sm font-medium">{i + 1}. {questionText(q)}</p>
                <QuestionMedia question={q} className="max-h-48 self-start" />
                {isSelfMarked(q.type) && <div className="self-start"><MarksBadge question={q} answer={answer} /></div>}
                {!isSelfMarked(q.type) && chosenOptionIds(answer).length === 0 && <p className="text-xs text-rose-600">Not answered</p>}
              </div>
            </div>
            {isSelfMarked(q.type) && <div className="sm:pl-6"><AnswerAndModel question={q} answer={answer} /></div>}
            {!isSelfMarked(q.type) && <div className={cn(
              "sm:pl-6",
              optionsLayout(q, "gap-2", "gap-1.5")
            )}>
              {q.options.map((opt) => {
                const isSelected = chosenOptionIds(answer).includes(opt.id)
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
                          : <img src={opt.imageUrl} alt={opt.text || "Answer"} className="w-full aspect-square object-cover" />}
                        {isCorrect && (
                          <span className="absolute top-1 right-1 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">✓ Correct</span>
                        )}
                        {isSelected && !isCorrect && (
                          <span className="absolute top-1 right-1 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">✗ Your answer</span>
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
            </div>}
          </div>
        )
      })}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
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
export function QuizTaker({ lessonId, enrollmentId, onCompleted, nextHref }: Props) {
  const { data, loading, refetch } = useFetch<QuizData>(`/api/student/lessons/${lessonId}/quiz`, {
    errorMessage: "Could not load this test",
  })

  const storageKey = draftKey(lessonId, enrollmentId)
  const [view, setView] = useState<"start" | "taking" | "marking" | "result" | "review-result" | "review-best">("start")
  // Starts from whatever was answered last time, if the test was left part-way.
  const [stored] = useState(() => readDraft(storageKey))
  const [rawSelected, setSelected] = useState<Record<string, string[]>>(stored?.selected ?? {})
  const [texts, setTexts] = useState<Record<string, string>>(stored?.texts ?? {})
  const [videos, setVideos] = useState<Record<string, string>>(stored?.videos ?? {})
  const [currentIndex, setCurrentIndex] = useState(stored?.currentIndex ?? 0)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [storyOpen, setStoryOpen] = useState(false)
  // Questions whose video has played to the end, for those shown after it.
  const [watched, setWatched] = useState<Set<string>>(() => new Set())
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view === "taking") writeDraft(storageKey, { selected: rawSelected, texts, videos, currentIndex })
  }, [view, storageKey, rawSelected, texts, videos, currentIndex])

  if (!data) {
    return loading
      ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      : <p className="text-sm text-muted-foreground text-center py-6">This test could not be loaded.</p>
  }

  const { questions, settings, attempts, bestAttempt } = data

  // Fingerspelling and vocabulary are played against the clock, one sign at a
  // time, and are sent in their own shape — the word is the answer.
  if (isSignTest(settings.kind)) {
    return (
      <SignTestTaker
        lessonId={lessonId}
        enrollmentId={enrollmentId}
        data={data as unknown as SignTestData}
        refetch={refetch}
        onCompleted={onCompleted}
        nextHref={nextHref}
      />
    )
  }

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

  // Only answers that still fit the test count: a question or an option may
  // have been changed by the teacher since they were given.
  const selected = Object.fromEntries(
    questions.flatMap((q) => {
      const ids = (rawSelected[q.id] ?? []).filter((id) => q.options.some((o) => o.id === id))
      // A question that has since become single-answer keeps only the first.
      const kept = q.multiple ? ids : ids.slice(0, 1)
      return kept.length > 0 ? [[q.id, kept]] : []
    })
  ) as Record<string, string[]>
  const isAnswered = (q: Question) =>
    q.type === "WRITTEN" ? !!texts[q.id]?.trim() : q.type === "SIGN" ? !!videos[q.id] : !!selected[q.id]
  const answered = questions.filter(isAnswered).length
  const firstUnanswered = questions.findIndex((q) => !isAnswered(q))
  const hasMarks = questions.some((q) => isSelfMarked(q.type))
  const pending = data.pendingAttempt

  function start() {
    setSelected({})
    setTexts({})
    setVideos({})
    setCurrentIndex(0)
    setResult(null)
    setError(null)
    setConfirming(false)
    setView("taking")
  }

  // Pick the test up where it was left.
  function resume() {
    setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : 0)
    setError(null)
    setConfirming(false)
    setView("taking")
  }

  function go(index: number) {
    setCurrentIndex(Math.min(Math.max(index, 0), questions.length - 1))
    setConfirming(false)
    // On a phone the next question would otherwise open scrolled to its answers.
    topRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  // One answer replaces the last; on a question with several correct answers
  // each one is ticked on or off.
  function choose(question: Question, optionId: string) {
    setSelected((s) => {
      if (!question.multiple) return { ...s, [question.id]: [optionId] }
      const current = s[question.id] ?? []
      return {
        ...s,
        [question.id]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
      }
    })
  }

  async function submit() {
    if (!enrollmentId) return
    setSubmitting(true)
    setError(null)
    try {
      const answers = questions.map((q) =>
        q.type === "WRITTEN" ? { questionId: q.id, text: texts[q.id] ?? "" }
        : q.type === "SIGN" ? { questionId: q.id, videoUrl: videos[q.id] }
        : { questionId: q.id, optionIds: selected[q.id] ?? [] })
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, answers }),
      })
      const body = await res.json() as Omit<Result, "answers" | "attemptId"> & { attempt: { id: string; answers: AttemptAnswer[] }; message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not submit your answers")
      setResult({ ...body, attemptId: body.attempt.id, answers: body.attempt.answers })
      // Written and signed answers are marked by the student before the score.
      setView(body.selfMarked ? "result" : "marking")
      setSelected({})
      setTexts({})
      setVideos({})
      setConfirming(false)
      writeDraft(storageKey, null)
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

  // ── Marking — straight after submitting, or coming back to it ─────────────
  if (view === "marking") {
    const marking = result && !result.selfMarked
      ? { attemptId: result.attemptId, questions: result.questions, answers: result.answers }
      : pending && { attemptId: pending.id, questions, answers: pending.answers }
    if (marking) {
      return (
        <MarkAnswers
          lessonId={lessonId}
          attemptId={marking.attemptId}
          questions={marking.questions}
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
              answers: marking.answers.map((a) => (a.questionId in marks ? { ...a, marks: marks[a.questionId], isCorrect: a.isCorrect || marks[a.questionId] === maxMarks(marking.questions.find((q) => q.id === a.questionId)) } : a)),
            })
            setView("result")
            if (marked.passed) onCompleted()
            void refetch()
          }}
        />
      )
    }
  }

  // ── Results screen ────────────────────────────────────────────────────────
  if (view === "result" && result) {
    const left = attemptsLeftText(result.attemptsLeft)
    const missed = Math.max(1, correctNeeded(result.passMark, result.total) - result.correct)
    return (
      <div className="flex flex-col items-center gap-6 py-8 px-4 text-center" aria-live="polite">
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
            {result.correct} / {result.total} {hasMarks ? "marks" : "correct"}
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

        {!result.passed && (
          <p className="text-sm text-muted-foreground max-w-sm">
            {hasMarks
              ? missed === 1 ? "One more mark" : `${missed} more marks`
              : missed === 1 ? "One more correct answer" : `${missed} more correct answers`} would have passed.
            {result.attemptsLeft === 0
              ? " You have no attempts left. Speak to your teacher if you need another go."
              : ` Look over your answers, then try again${left ? ` — ${left}` : ""}.`}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={() => setView("review-result")}>
            Review answers
          </Button>
          {!result.passed && result.attemptsLeft !== 0 && (
            <Button onClick={start}>
              <RotateCcw className="size-4 mr-1.5" /> Try again
            </Button>
          )}
          {result.passed && nextHref && (
            <Button asChild>
              <Link href={nextHref}>Continue <ChevronRight className="size-4 ml-1" /></Link>
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
    // Watch first, then answer: such a question waits until its video has
    // played through, unless it was answered already (e.g. coming back to it).
    const waitingForVideo = !!q?.questionAfterVideo && isVideoMedia(q.imageUrl, q.mediaType) &&
      !watched.has(q.id) && !isAnswered(q)
    const progress = Math.round((answered / questions.length) * 100)
    const isLast = currentIndex === questions.length - 1
    const allAnswered = answered === questions.length
    const limited = settings.maxAttempts !== null

    return (
      <div ref={topRef} className="flex flex-col gap-5 py-2 scroll-mt-24">
        {/* Progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Question {currentIndex + 1} of {questions.length}</span>
            <span className="flex items-center gap-3">
              <span>{answered} answered</span>
              <button
                type="button"
                onClick={() => setView("start")}
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                title="Your answers are kept, so you can carry on later"
              >
                <LogOut className="size-3" /> Finish later
              </button>
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Every question at a glance — jump to any of them, in any order */}
        {questions.length > 1 && (
          <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
            {questions.map((question, i) => {
              const isCurrent = i === currentIndex
              const done = isAnswered(question)
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Question ${i + 1}, ${done ? "answered" : "not answered"}`}
                  className={cn(
                    "size-8 rounded-lg border text-xs font-semibold transition-colors",
                    done ? "bg-primary/10 border-primary/30 text-primary" : "bg-background text-muted-foreground hover:bg-muted",
                    isCurrent && "ring-2 ring-primary ring-offset-1"
                  )}
                >
                  {i + 1}
                </button>
              )
            })}
          </nav>
        )}

        {/* The story stays to hand while its questions are answered */}
        {settings.storyUrl && (
          <div className="flex flex-col gap-2">
            <Button
              type="button" variant="outline" size="sm" className="self-start"
              aria-expanded={storyOpen}
              onClick={() => setStoryOpen((open) => !open)}
            >
              <BookOpen className="size-4 mr-1.5" /> {storyOpen ? "Hide the story" : "Watch the story again"}
            </Button>
            {storyOpen && (
              <StoryVideo src={settings.storyUrl} controls={settings.storyControls !== false} autoPlay className="w-full max-h-80 rounded-xl border bg-black" />
            )}
          </div>
        )}

        {/* Question */}
        {q && (
          <div className="rounded-xl border bg-muted/20 p-4 sm:p-5 flex flex-col gap-4">
            <div>
              <p id={`question-${q.id}`} className="font-semibold text-base leading-snug">
                {currentIndex + 1}. {waitingForVideo ? "Watch the video — the question and answers appear when it ends." : questionText(q)}
              </p>
              {q.multiple && !waitingForVideo && (
                <p className="text-sm text-primary font-medium mt-1">More than one answer is correct — tick them all.</p>
              )}
            </div>

            {/* Optional question image or video */}
            <QuestionMedia
              question={q}
              controls={!!q.videoControls}
              onEnded={waitingForVideo ? () => setWatched((prev) => new Set(prev).add(q.id)) : undefined}
              className="max-h-64 mx-auto"
            />

            {!waitingForVideo && q.type === "WRITTEN" && (
              <div className="flex flex-col gap-1.5">
                <Textarea
                  aria-labelledby={`question-${q.id}`}
                  rows={4}
                  maxLength={5000}
                  placeholder="Type your answer"
                  value={texts[q.id] ?? ""}
                  onChange={(e) => setTexts((t) => ({ ...t, [q.id]: e.target.value }))}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">The more detail, the more marks. You mark it yourself after you submit.</p>
              </div>
            )}

            {!waitingForVideo && q.type === "SIGN" && (
              <div className="flex flex-col gap-1.5">
                <SignAnswerRecorder
                  key={q.id}
                  lessonId={lessonId}
                  videoUrl={videos[q.id]}
                  onChange={(url) => setVideos((v) => {
                    const next = { ...v }
                    if (url) next[q.id] = url
                    else delete next[q.id]
                    return next
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  Film yourself signing it. After you submit, the correct sign plays next to yours and you mark it yourself.
                </p>
              </div>
            )}

            {/* Options — side by side when they are pictures or videos */}
            {!waitingForVideo && !isSelfMarked(q.type) && (
              <div role={q.multiple ? "group" : "radiogroup"} aria-labelledby={`question-${q.id}`} className={optionsLayout(q, "gap-3", "gap-2")}>
                {q.options.map((opt, n) => {
                  const isSelected = !!selected[q.id]?.includes(opt.id)
                  const role = q.multiple ? "checkbox" : "radio"
                  const isVideo = isVideoMedia(opt.imageUrl, opt.mediaType)
                  const name = opt.text || `Answer ${n + 1}`

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
                            controls={!!q.videoControls}
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
                          role={role}
                          aria-checked={isSelected}
                          onClick={() => choose(q, opt.id)}
                          className={cn(
                            "px-3 py-3 text-sm font-medium text-center w-full transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-foreground hover:bg-muted"
                          )}
                        >
                          {isSelected ? `✓ ${opt.text || "Selected"}` : opt.text || "Select this answer"}
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
                        role={role}
                        aria-checked={isSelected}
                        aria-label={name}
                        onClick={() => choose(q, opt.id)}
                        className={cn(
                          "rounded-xl border overflow-hidden flex flex-col transition-all",
                          isSelected
                            ? "border-primary ring-2 ring-primary"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <div className="relative w-full">
                          <img src={opt.imageUrl} alt={name} className="w-full aspect-square object-cover" />
                          {isSelected && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <CheckCircle2 className="size-8 text-primary drop-shadow" />
                            </div>
                          )}
                        </div>
                        {opt.text && (
                          <div className={cn(
                            "px-3 py-2 text-xs font-medium text-center w-full",
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
                      role={role}
                      aria-checked={isSelected}
                      onClick={() => choose(q, opt.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-left transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-border"
                      )}
                    >
                      {/* A round dot for one answer, a tick box where several can be chosen */}
                      <div className={cn(
                        "size-4 border-2 shrink-0 flex items-center justify-center",
                        q.multiple ? "rounded" : "rounded-full",
                        isSelected ? "border-primary-foreground bg-primary-foreground" : "border-muted-foreground"
                      )}>
                        {isSelected && (q.multiple
                          ? <Check className="size-3 text-primary" strokeWidth={3} />
                          : <div className="size-2 rounded-full bg-primary" />)}
                      </div>
                      {opt.text}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* At the end with gaps: say which, rather than a dead Submit button */}
        {isLast && !allAnswered && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>
              {questions.length - answered === 1
                ? "1 question still needs an answer"
                : `${questions.length - answered} questions still need an answer`} before you can submit.
            </span>
            {firstUnanswered !== currentIndex && (
              <Button size="sm" variant="outline" className="bg-background" onClick={() => go(firstUnanswered)}>
                Go to question {firstUnanswered + 1}
              </Button>
            )}
          </div>
        )}

        {confirming ? (
          // Asked only when attempts are limited — a practice test just submits.
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-semibold">Submit your answers?</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                You can&apos;t change them afterwards. This is attempt {attempts.length + 1} of {settings.maxAttempts}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting
                  ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Submitting…</>
                  : "Yes, submit"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>
                Check my answers first
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => go(currentIndex - 1)} disabled={currentIndex === 0}>
              <ChevronLeft className="size-4 mr-1" /> Previous
            </Button>

            <div className="flex items-center gap-2">
              {!isLast && (
                <Button variant={allAnswered ? "outline" : "default"} onClick={() => go(currentIndex + 1)}>
                  {q && isAnswered(q) ? "Next" : "Skip"} <ChevronRight className="size-4 ml-1" />
                </Button>
              )}
              {/* Offered as soon as everything is answered, wherever the student is */}
              {(isLast || allAnswered) && (
                <Button
                  onClick={limited ? () => setConfirming(true) : submit}
                  disabled={!allAnswered || submitting || !enrollmentId}
                >
                  {submitting
                    ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Submitting…</>
                    : "Submit Test"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Start screen — the rules, and how previous attempts went ───────────────
  const left = attemptsLeftText(data.attemptsLeft)
  const inProgress = answered > 0
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
            {settings.storyUrl && "Watch the story first — you can watch it again while you answer. "}
            Answer every question, then submit. You can skip a question and come back to it, and change any answer before you submit.
          </p>
        )}
      </div>

      {settings.storyUrl && (
        <StoryVideo src={settings.storyUrl} controls={settings.storyControls !== false} className="w-full max-h-96 rounded-xl border bg-black" />
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
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

      {pending && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-center">
          <p className="text-sm text-amber-900">
            You submitted this test but haven&apos;t marked your written or signed answers yet. Mark them to get your score.
          </p>
          <Button onClick={() => setView("marking")}>
            <PenLine className="size-4 mr-1.5" /> Mark your answers
          </Button>
        </div>
      )}

      {!pending && <div className="flex flex-wrap items-center justify-center gap-3">
        {canAttempt && inProgress ? (
          <>
            <Button onClick={resume} disabled={!enrollmentId}>
              Continue test <ChevronRight className="size-4 ml-1" />
            </Button>
            <Button onClick={start} disabled={!enrollmentId} variant="outline">
              <RotateCcw className="size-4 mr-1.5" /> Start again
            </Button>
          </>
        ) : canAttempt ? (
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
      </div>}

      {canAttempt && inProgress && (
        <p className="text-xs text-muted-foreground text-center">
          You answered {answered} of {questions.length} last time — your answers have been kept.
        </p>
      )}

      {canAttempt && left && !hasPassed && (
        <p className="text-xs text-muted-foreground text-center">
          {left}.{!data.answersRevealed && " The correct answers are shown once you pass or have used every attempt."}
        </p>
      )}

      {!enrollmentId && (
        <p className="text-xs text-muted-foreground text-center">Enrol in this course to take this test.</p>
      )}

      <AttemptHistory attempts={attempts} />
    </div>
  )
}
