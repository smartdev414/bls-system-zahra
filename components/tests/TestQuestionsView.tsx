"use client"

import { Fragment } from "react"
import { CheckCircle2, Circle, Lock } from "lucide-react"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { isAssessment, isPresentation, isReflection, isSignTest, isVideoMedia, marksLabel, maxMarks } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { TaskFileLink } from "@/components/quiz/TaskFile"

export type ViewQuestion = {
  id: string
  question: string
  imageUrl: string | null
  mediaType: string | null
  type?: string
  /** WRITTEN: what a full-marks answer says. */
  modelAnswer?: string | null
  /** WRITTEN: what it is worth; null = 3. */
  maxMarks?: number | null
  /** SIGN: the sign done right. */
  answerVideoUrl?: string | null
  /** An assessment's part: its questions, signed. */
  questionsVideoUrl?: string | null
  /** A presentation's task: a file that goes with it. */
  attachmentUrl?: string | null
  /** A self-reflection's criterion that is not part of this assessment. */
  locked?: boolean
  /** A self-reflection's criterion: the heading it sits under. */
  section?: string | null
  options: Array<{ id: string; text: string; imageUrl: string | null; mediaType: string | null; isCorrect: boolean }>
}

function Media({ url, type, alt, className }: { url: string; type: string | null; alt: string; className?: string }) {
  return isVideoMedia(url, type)
    ? <ProtectedVideo src={url} muted loop playsInline controls className={cn("bg-black", className)} />
    : <img src={url} alt={alt} className={cn("object-contain", className)} />
}

/** A test's questions with the correct answers marked — for staff, never students. */
export function TestQuestionsView({ kind, storyUrl, questions }: {
  kind: string
  storyUrl: string | null
  questions: ViewQuestion[]
}) {
  const signTest = isSignTest(kind)
  const noun = signTest ? "sign" : isReflection(kind) ? "criterion" : isPresentation(kind) ? "task" : isAssessment(kind) ? "part" : "question"

  return (
    <div className="flex flex-col gap-6">
      {storyUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{isAssessment(kind) ? "Synopsis" : "The story"}</p>
          <ProtectedVideo src={storyUrl} playsInline controls className="rounded-lg max-h-72 border bg-black self-start" />
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {noun === "criterion" ? "criteria" : `${noun}s`} have been added to this test yet.</p>
      ) : isReflection(kind) ? (
        // A self-reflection: its criteria, the ones students write about ticked.
        <ol className="flex flex-col gap-2">
          {questions.map((q, i) => (
            <Fragment key={q.id}>
            {(i === 0 || questions[i - 1].section !== q.section) && q.section && (
              <li role="presentation" className="pt-3 first:pt-0 text-sm font-bold">{q.section}</li>
            )}
            <li className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm", q.locked && "border-dashed bg-muted/30 text-muted-foreground")}>
              {q.locked ? <Lock className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
              <div className="min-w-0">
                <p className="whitespace-pre-wrap">{q.section || /^\s*(\d|[a-z][.)]\s)/i.test(q.question) ? "" : `${i + 1}. `}{q.question}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{q.locked ? "Not part of this assessment" : "Students write about this"}</p>
              </div>
            </li>
            </Fragment>
          ))}
        </ol>
      ) : isPresentation(kind) ? (
        // A presentation: its one task.
        questions.map((q) => (
          <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
            <p className="font-semibold">The task <span className="font-normal text-muted-foreground">· {marksLabel(maxMarks(q))}</span></p>
            {q.question && <p className="text-sm whitespace-pre-wrap">{q.question}</p>}
            {q.imageUrl && <Media url={q.imageUrl} type={q.mediaType} alt="" className="w-full max-w-md aspect-video rounded-lg border" />}
            {q.attachmentUrl && <TaskFileLink url={q.attachmentUrl} />}
            <p className="text-xs text-muted-foreground">Students film themselves presenting it. A teacher marks it in Results.</p>
          </div>
        ))
      ) : isAssessment(kind) ? (
        // An assessment: each part's questions, the part, and its answer sheet.
        <div className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <div key={q.id} className="rounded-xl border p-4 flex flex-col gap-3">
              <p className="font-semibold">Part {i + 1} <span className="font-normal text-muted-foreground">· {marksLabel(maxMarks(q))}</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">The questions</p>
                  {q.questionsVideoUrl && <Media url={q.questionsVideoUrl} type="video" alt="" className="w-full aspect-video rounded-lg border" />}
                  {q.question && <p className="text-sm whitespace-pre-wrap">{q.question}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">The part</p>
                  {q.imageUrl && <Media url={q.imageUrl} type={q.mediaType} alt="" className="w-full aspect-video rounded-lg border" />}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-600">Answer sheet</p>
                <p className="whitespace-pre-wrap">{q.modelAnswer}</p>
              </div>
            </div>
          ))}
        </div>
      ) : signTest ? (
        // A fingerspelling or vocabulary test: each sign and the word it is.
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {questions.length} sign{questions.length !== 1 ? "s" : ""} · the word each one is
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border overflow-hidden">
                {q.imageUrl && <Media url={q.imageUrl} type={q.mediaType} alt={q.question} className="w-full aspect-video" />}
                <p className="px-2 py-1.5 text-sm font-semibold truncate">{i + 1}. {q.question}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {questions.length} question{questions.length !== 1 ? "s" : ""} · correct answers shown
          </p>
          {questions.map((q, i) => (
            <div key={q.id} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{i + 1}. {q.question}{q.type === "WRITTEN" && ` (${marksLabel(maxMarks(q))})`}</p>
              {q.imageUrl && (
                <Media url={q.imageUrl} type={q.mediaType} alt="question" className="rounded-lg max-h-48 border self-start" />
              )}
              {q.type === "WRITTEN" && (
                <div className="ml-6 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-600">Model answer · students mark themselves 0–{maxMarks(q)}</p>
                  <p className="whitespace-pre-wrap mt-0.5">{q.modelAnswer}</p>
                </div>
              )}
              {q.type === "SIGN" && (
                <div className="ml-6 flex flex-col gap-1">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-600">The sign done right · students film themselves and tick or cross</p>
                  {q.answerVideoUrl && (
                    <Media url={q.answerVideoUrl} type="video" alt={q.question} className="rounded-lg max-h-48 border self-start" />
                  )}
                </div>
              )}
              <div className={cn(
                "pl-6",
                q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1.5"
              )}>
                {q.options.map((opt) => (
                  <div
                    key={opt.id}
                    className={cn(
                      "rounded-lg border text-sm overflow-hidden",
                      opt.imageUrl ? "flex flex-col p-0" : "flex items-center gap-2 px-3 py-2",
                      opt.isCorrect && "border-emerald-300 bg-emerald-50 text-emerald-800",
                    )}
                  >
                    {opt.imageUrl && (
                      <Media url={opt.imageUrl} type={opt.mediaType} alt={opt.text} className="w-full aspect-video object-cover" />
                    )}
                    <div className={cn("flex items-center gap-2 w-full", opt.imageUrl ? "px-2 py-1.5" : "")}>
                      {opt.isCorrect
                        ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        : <Circle className="size-3.5 shrink-0 text-muted-foreground" />}
                      {opt.text && <span className="text-xs">{opt.text}</span>}
                      {opt.isCorrect && (
                        <span className="ml-auto text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-600">Correct</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
