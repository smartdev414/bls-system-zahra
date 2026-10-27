"use client"

import { useState } from "react"
import { Check, Download, Loader2, PenLine, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { mediaDownloadHref } from "@/lib/protected-media"
import { isSelfMarked, isVideoMedia, marksLabel, maxMarks } from "@/lib/quiz"
import { cn } from "@/lib/utils"

// Written and signed answers, which the student marks themselves: in a
// Questions or Story test, and the words signed in a vocabulary test (passed
// in as signed questions, the word as the question and the sign as the model).

export type MarkQuestion = {
  id: string
  question: string
  type: string
  /** WRITTEN: what it is worth; null = 3. */
  maxMarks?: number | null
  /** WRITTEN: the model answer — sent once the student has submitted, to mark themselves against. */
  modelAnswer?: string | null
  /** SIGN: the sign done right — likewise only after submitting. */
  answerVideoUrl?: string | null
  /** SIGN: "image" when the sign is only a picture (a dictionary sign with no clip). */
  answerMediaType?: string | null
  /**
   * An assessment's part: the answers were filmed (videoUrl), and are marked
   * against the written answer sheet (modelAnswer), 0 up to its marks.
   */
  filmed?: boolean
}

export type MarkAnswer = {
  questionId: string
  /** WRITTEN: what the student wrote. */
  answerText?: string | null
  /** SIGN: the student's recording; gone once the course is archived. */
  videoUrl?: string | null
  /** The marks given; null until the student has marked it. */
  marks?: number | null
  markedByTutor?: boolean
  /** A filmed answer a teacher marked: their feedback, recorded over the student's video. */
  feedbackVideoUrl?: string | null
}

/** The question as students read it — a written one says what it is worth: "… (2 marks)". */
export function questionText(q: Pick<MarkQuestion, "question" | "type" | "maxMarks">): string {
  return q.type === "WRITTEN" ? `${q.question} (${marksLabel(maxMarks(q))})` : q.question
}

/** The student's own recording, with a way to keep it — or why it is not there. */
export function OwnVideo({ answer, loop = false }: { answer?: MarkAnswer; loop?: boolean }) {
  return answer?.videoUrl
    ? <>
        {/* A sign of a few seconds loops beside the model; minutes of answers wait to be played. */}
        <ProtectedVideo src={answer.videoUrl} controls playsInline autoPlay={loop} muted={loop} loop={loop} className="w-full aspect-video rounded-lg border bg-black" />
        <a href={mediaDownloadHref(answer.videoUrl)} download className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline">
          <Download className="size-3.5" /> Download my video
        </a>
      </>
    : <p className="text-xs text-muted-foreground rounded-lg border px-3 py-6 text-center">
        {answer?.marks === 0 && !answer.markedByTutor ? "No video recorded" : "Your video has been deleted (the course has ended)"}
      </p>
}

/** The teacher's feedback on a filmed answer, if they recorded any. */
export function TeacherFeedback({ answer }: { answer?: MarkAnswer }) {
  if (!answer?.feedbackVideoUrl) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Your teacher&apos;s feedback</p>
      <ProtectedVideo src={answer.feedbackVideoUrl} controls playsInline className="w-full aspect-video rounded-lg border border-primary/40 bg-black" />
    </div>
  )
}

/** What the student wrote or signed, side by side with the model answer. */
export function AnswerAndModel({ question, answer }: { question: MarkQuestion; answer?: MarkAnswer }) {
  const box = "rounded-lg border px-3 py-2 text-sm flex flex-col gap-1"
  const label = "text-[10px] font-semibold uppercase tracking-wide"
  if (question.filmed) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <p className={cn(label, "text-muted-foreground")}>Your answers</p>
          <OwnVideo answer={answer} />
        </div>
        {question.modelAnswer
          ? <div className={cn(box, "border-emerald-300 bg-emerald-50 text-emerald-900 self-start")}>
              <p className={cn(label, "text-emerald-600")}>Answer sheet</p>
              <p className="whitespace-pre-wrap">{question.modelAnswer}</p>
            </div>
          : <p className={cn(box, "text-muted-foreground self-start")}>The answer sheet is shown once your teacher has marked your answers.</p>}
        <div className="sm:col-span-2"><TeacherFeedback answer={answer} /></div>
      </div>
    )
  }
  if (question.type === "SIGN") {
    const model = question.answerVideoUrl
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <p className={cn(label, "text-muted-foreground")}>You</p>
          <OwnVideo answer={answer} loop />
        </div>
        <div className="flex flex-col gap-1">
          <p className={cn(label, "text-emerald-600")}>The sign done right</p>
          {model && (isVideoMedia(model, question.answerMediaType)
            ? <ProtectedVideo src={model} controls playsInline autoPlay muted loop className="w-full aspect-video rounded-lg border border-emerald-300 bg-black" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={model} alt="The sign" className="w-full aspect-video rounded-lg border border-emerald-300 bg-black object-contain" draggable={false} />)}
        </div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className={box}>
        <p className={cn(label, "text-muted-foreground")}>Your answer</p>
        <p className={cn("whitespace-pre-wrap", !answer?.answerText && "text-muted-foreground")}>{answer?.answerText || "Not answered"}</p>
      </div>
      <div className={cn(box, "border-emerald-300 bg-emerald-50 text-emerald-900")}>
        <p className={cn(label, "text-emerald-600")}>Model answer</p>
        <p className="whitespace-pre-wrap">{question.modelAnswer}</p>
      </div>
    </div>
  )
}

/** The marks given, as a badge: "2 / 3 marks", or a tick or cross for a signed answer. */
export function MarksBadge({ question, answer }: { question: MarkQuestion; answer?: MarkAnswer }) {
  if (answer?.marks === null || answer?.marks === undefined) return <Badge variant="outline" className="text-[10px]">Not marked yet</Badge>
  const max = maxMarks(question)
  const full = answer.marks === max
  return (
    <Badge variant="outline" className={cn("text-[10px]", full ? "bg-emerald-50 text-emerald-700 border-emerald-200" : answer.marks > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200")}>
      {question.type === "SIGN" ? (full ? "✓ Correct" : "✗ Not right") : `${answer.marks} / ${max} marks`}
      {answer.markedByTutor && " · marked by your teacher"}
    </Badge>
  )
}

export type MarkedResult = { score: number; passed: boolean; earned: number; total: number; attemptsLeft: number | null }

/**
 * Straight after submitting: the student compares each written or signed
 * answer with the model and marks it — 0 up to what it is worth for writing,
 * a tick or a cross for signing. Their score is worked out once every one is
 * marked.
 */
export function MarkAnswers({ lessonId, attemptId, questions, answers, onMarked }: {
  lessonId: string
  attemptId: string
  questions: MarkQuestion[]
  answers: MarkAnswer[]
  onMarked: (result: MarkedResult, marks: Record<string, number>) => void
}) {
  const toMark = questions.filter((q) => isSelfMarked(q.type) && answers.some((a) => a.questionId === q.id))
  const [marks, setMarks] = useState<Record<string, number>>(() =>
    Object.fromEntries(answers.flatMap((a) => (typeof a.marks === "number" ? [[a.questionId, a.marks]] : []))))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = toMark.filter((q) => marks[q.id] === undefined).length

  async function finish() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marks }),
      })
      const body = await res.json().catch(() => ({})) as MarkedResult & { message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not save your marks")
      onMarked(body, marks)
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not save your marks. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      <div>
        <h3 className="font-bold flex items-center gap-2"><PenLine className="size-4 text-primary" /> Mark your answers</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Compare each answer with the correct one and mark it honestly. Your teacher can see your marks and may change them.
        </p>
      </div>

      {toMark.map((q) => {
        const answer = answers.find((a) => a.questionId === q.id)
        // A signed answer is blank without a recording, whatever else was answered
        // (a vocabulary test done both ways also keeps the word picked).
        const blank = answer?.marks === 0 && (q.type === "SIGN" ? !answer.videoUrl : !answer.answerText)
        const max = maxMarks(q)
        return (
          <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
            {q.filmed
              ? <div>
                  <p className="text-sm font-semibold">Part {questions.indexOf(q) + 1} ({marksLabel(max)})</p>
                  {q.question && <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{q.question}</p>}
                </div>
              : <p className="text-sm font-medium">{questions.indexOf(q) + 1}. {questionText(q)}</p>}
            <AnswerAndModel question={q} answer={answer} />
            {blank ? (
              <p className="text-xs text-muted-foreground">Not answered — 0 marks.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">
                  {q.type === "SIGN"
                    ? "Does your signing match?"
                    : q.filmed
                    ? "Watch your video and check it against the answer sheet. How many marks did you get?"
                    : "How many marks did you get? More detail that matches the model answer earns more."}
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Marks for question ${questions.indexOf(q) + 1}`}>
                  {(q.type === "SIGN" ? [1, 0] : Array.from({ length: max + 1 }, (_, n) => n)).map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={marks[q.id] === n}
                      variant={marks[q.id] === n ? "default" : "outline"}
                      className={cn("min-w-12", q.type === "SIGN" && marks[q.id] === n && (n ? "bg-emerald-600 hover:bg-emerald-600" : "bg-rose-600 hover:bg-rose-600"))}
                      onClick={() => setMarks((m) => ({ ...m, [q.id]: n }))}
                    >
                      {q.type === "SIGN" ? (n ? <><Check className="size-4 mr-1" /> Yes</> : <><XCircle className="size-4 mr-1" /> No</>) : n}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {error && (
        <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={finish} disabled={left > 0 || saving}>
          {saving ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Saving…</> : "Finish and see my score"}
        </Button>
        {left > 0 && <span className="text-xs text-muted-foreground">{left === 1 ? "1 answer" : `${left} answers`} still to mark</span>}
      </div>
    </div>
  )
}
