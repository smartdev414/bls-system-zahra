"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ChevronRight, Hourglass, Loader2, Presentation, RotateCcw, Send, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { marksLabel, maxMarks } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { AttemptHistory, attemptsLeftText } from "./AttemptHistory"
import type { AssessmentData } from "./AssessmentTaker"
import { MarksBadge, OwnVideo, TeacherFeedback, type MarkQuestion } from "./SelfMarking"
import { SignAnswerRecorder } from "./SignAnswerRecorder"
import { TaskFileLink } from "./TaskFile"
import { useTopOnNewScreen } from "./TestTop"

// A presentation: the student reads (or watches) the task, films themselves
// presenting it, and sends it to their teacher. The teacher marks it and can
// record feedback over it; the student then sees both here. It comes in the
// same shape as an assessment with one part — the task.

/** The recording made but not sent yet, kept on the device so a refresh does not lose it. */
function draftKey(lessonId: string, enrollmentId: string | null) {
  return `presentation:${lessonId}:${enrollmentId ?? "preview"}`
}
function readDraft(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
function writeDraft(key: string, url: string | undefined) {
  try {
    if (url) localStorage.setItem(key, url)
    else localStorage.removeItem(key)
  } catch { /* private mode: it just is not kept */ }
}

const minutesText = (m: number) => (m === 1 ? "1 minute" : `${m} minutes`)

export function PresentationTaker({ lessonId, enrollmentId, data, refetch, nextHref }: {
  lessonId: string
  enrollmentId: string | null
  data: AssessmentData
  refetch: () => void | Promise<unknown>
  nextHref?: string
}) {
  const key = draftKey(lessonId, enrollmentId)
  const [videoUrl, setVideoUrl] = useState<string | undefined>(() => readDraft(key))
  const [view, setView] = useState<"start" | "sent" | "review">("start")
  // A student who has presented before records a new one only when they ask to.
  const [recordingNew, setRecordingNew] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useTopOnNewScreen(view)

  useEffect(() => { writeDraft(key, videoUrl) }, [key, videoUrl])

  const task = data.questions[0]
  if (!task) {
    return (
      <div className="text-center py-6">
        <Presentation className="size-10 text-primary mx-auto mb-2" />
        <p className="font-semibold">Not ready yet</p>
        <p className="text-sm text-muted-foreground mt-1">The task for this presentation hasn&apos;t been added yet.</p>
      </div>
    )
  }

  const { settings, attempts } = data
  const asQuestion: MarkQuestion = { ...task, filmed: true }
  const hasPassed = attempts.some((a) => a.passed)
  const canAttempt = data.attemptsLeft !== 0
  const pending = data.pendingAttempt
  const best = data.bestAttempt
  const bestAnswer = best?.answers.find((a) => a.questionId === task.id)

  async function send() {
    if (!enrollmentId || !videoUrl) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/quiz/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ questionId: task.id, videoUrl }] }),
      })
      const body = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(body.message ?? "Could not send your presentation")
      setVideoUrl(undefined)
      setRecordingNew(false)
      setView("sent")
      void refetch()
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not send your presentation. Check your connection and try again.")
    } finally {
      setSending(false)
    }
  }

  // ── Sent ──────────────────────────────────────────────────────────────────
  if (view === "sent") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 text-center" aria-live="polite">
        <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center">
          <CheckCircle2 className="size-10 text-primary" />
        </div>
        <div>
          <p className="text-xl font-bold">Sent to your teacher</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Your teacher will watch your presentation and mark it. You will get a notification with your score and their feedback.
          </p>
        </div>
        <Button variant="outline" onClick={() => setView("start")}>Done</Button>
      </div>
    )
  }

  // ── The marked presentation, with the teacher's feedback ──────────────────
  if (view === "review" && best) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={() => setView("start")}>← Back</Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Your presentation</p>
          <MarksBadge question={asQuestion} answer={bestAnswer} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><OwnVideo answer={bestAnswer} /></div>
          {bestAnswer?.feedbackVideoUrl
            ? <TeacherFeedback answer={bestAnswer} />
            : <p className="rounded-lg border px-3 py-6 text-center text-xs text-muted-foreground self-start">Your teacher didn&apos;t record feedback this time.</p>}
        </div>
      </div>
    )
  }

  const left = attemptsLeftText(data.attemptsLeft)
  const showRecorder = canAttempt && !pending && !!enrollmentId && (attempts.length === 0 || recordingNew || !!videoUrl)

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn("size-16 rounded-full flex items-center justify-center", hasPassed ? "bg-emerald-100" : "bg-primary/10")}>
          {hasPassed ? <Trophy className="size-8 text-emerald-600" /> : <Presentation className="size-8 text-primary" />}
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
            Read the task, then film yourself presenting it — you have {minutesText(settings.answerMinutes)}. Watch it back, record
            again if you like, and send it to your teacher to mark.
          </p>
        )}
      </div>

      {/* The task */}
      <div className="rounded-xl border p-4 flex flex-col gap-3">
        <p className="text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
          The task · {marksLabel(maxMarks(task))}
        </p>
        {task.question && <p className="text-sm whitespace-pre-wrap">{task.question}</p>}
        {task.imageUrl && (
          <ProtectedVideo src={task.imageUrl} controls playsInline className="w-full max-h-[50vh] rounded-lg border bg-black" />
        )}
        {task.attachmentUrl && <TaskFileLink url={task.attachmentUrl} />}
      </div>

      {pending && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-4 text-sm">
          <Hourglass className="size-5 text-primary shrink-0" />
          <p>Your presentation is with your teacher to mark. You will get a notification with your score and their feedback.</p>
        </div>
      )}

      {showRecorder && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Your presentation · {minutesText(settings.answerMinutes)} to finish</p>
          <SignAnswerRecorder
            lessonId={lessonId}
            videoUrl={videoUrl}
            onChange={setVideoUrl}
            maxSeconds={settings.answerMinutes * 60}
            filmLabel="Film your presentation"
          />
          {error && (
            <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
          )}
          {videoUrl && (
            <Button className="self-start" onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Send className="size-4 mr-1.5" />}
              Send to my teacher
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {!showRecorder && !pending && canAttempt && attempts.length > 0 && (
          <Button variant={hasPassed ? "outline" : "default"} onClick={() => setRecordingNew(true)} disabled={!enrollmentId}>
            <RotateCcw className="size-4 mr-1.5" /> {hasPassed ? "Present again" : "Try again"}
          </Button>
        )}
        {best && <Button variant="outline" onClick={() => setView("review")}>See marks and feedback</Button>}
        {hasPassed && nextHref && (
          <Button asChild><Link href={nextHref}>Continue <ChevronRight className="size-4 ml-1" /></Link></Button>
        )}
      </div>

      {!canAttempt && !hasPassed && !pending && (
        <p className="text-sm text-muted-foreground text-center">You have no attempts left. Speak to your teacher if you need another go.</p>
      )}
      {canAttempt && left && !hasPassed && <p className="text-xs text-muted-foreground text-center">{left}.</p>}
      {!enrollmentId && <p className="text-xs text-muted-foreground text-center">Enrol in this course to do this presentation.</p>}

      <AttemptHistory attempts={attempts} />
    </div>
  )
}
