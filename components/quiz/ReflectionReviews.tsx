"use client"

import { Fragment, useState } from "react"
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, RotateCcw, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFetch } from "@/hooks/use-fetch"
import { wordCount } from "@/lib/quiz"
import { cn } from "@/lib/utils"
import { SignAnswerRecorder } from "./SignAnswerRecorder"
import {
  FeedbackCard, STATUS_INFO, SectionHeading, criterionNumber, sectionStart,
  type ReflectionCriterion, type ReflectionFeedbackItem, type ReflectionStatus,
} from "./ReflectionTaker"

type StudentRow = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  status: ReflectionStatus | "NONE"
  submittedAt: string | null
  updatedAt: string | null
  rounds: number
}

type Detail = {
  student: { id: string; name: string; email: string; avatarUrl: string | null }
  criteria: ReflectionCriterion[]
  submission: {
    status: ReflectionStatus
    answers: Record<string, string>
    submittedAt: string | null
    updatedAt: string
    feedback: ReflectionFeedbackItem[]
  } | null
}

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

function StudentAvatar({ student, className }: { student: { name: string; avatarUrl: string | null }; className?: string }) {
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      {student.avatarUrl && <AvatarImage src={student.avatarUrl} alt={student.name} />}
      <AvatarFallback className="bg-primary/10 text-[0.625rem] font-semibold text-primary">{initials(student.name)}</AvatarFallback>
    </Avatar>
  )
}

/**
 * A course's self-reflections, for its teachers: who has sent theirs in
 * (first), and each one opened to read, comment on and send back or accept.
 */
export function ReflectionReviews({ lessonId }: { lessonId: string }) {
  const { data, loading, refetch } = useFetch<{ students: StudentRow[] }>(`/api/tutor/lessons/${lessonId}/reflections`, {
    errorMessage: "Could not load the self-reflections",
  })
  const [openId, setOpenId] = useState<string | null>(null)

  if (openId) {
    return <ReflectionReview lessonId={lessonId} studentId={openId} onClose={() => { setOpenId(null); void refetch() }} />
  }

  if (!data) {
    return loading
      ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      : <p className="py-6 text-center text-sm text-muted-foreground">Could not load the self-reflections.</p>
  }

  const waiting = data.students.filter((s) => s.status === "SUBMITTED").length
  if (data.students.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No students on this course yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {waiting > 0
          ? <><span className="font-semibold text-foreground">{waiting} waiting for you.</span> Open one to read it and reply.</>
          : "Nothing is waiting for you. Students appear here when they send their self-reflection."}
      </p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {data.students.map((s) => {
          const canOpen = s.status !== "NONE" && s.status !== "DRAFT"
          const info = STATUS_INFO[s.status]
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => setOpenId(s.id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors enabled:hover:bg-muted/40 disabled:cursor-default"
              >
                <StudentAvatar student={s} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.status === "SUBMITTED" && s.submittedAt ? `Sent ${dateTime(s.submittedAt)}`
                      : s.status === "DRAFT" ? "Still writing — not sent yet"
                      : s.status === "NONE" ? "Not started"
                      : s.updatedAt ? `Updated ${dateTime(s.updatedAt)}` : ""}
                    {s.rounds > 0 && s.status !== "NONE" ? ` · sent back ${s.rounds === 1 ? "once" : `${s.rounds} times`}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className={cn("shrink-0", info.className)}>{info.label}</Badge>
                {canOpen && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Uploads a teacher's filmed feedback into the student's private folder; resolves to its URL. */
async function uploadFeedbackVideo(lessonId: string, studentId: string, file: Blob): Promise<string> {
  const res = await fetch(`/api/tutor/lessons/${lessonId}/reflections/${studentId}/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "video/webm", fileSize: file.size }),
  })
  const data = await res.json().catch(() => ({})) as { presignedUrl?: string; fileUrl?: string; contentType?: string; message?: string }
  if (!res.ok || !data.presignedUrl || !data.fileUrl) throw new Error(data.message ?? "Could not upload your video")
  const put = await fetch(data.presignedUrl, { method: "PUT", headers: { "Content-Type": data.contentType! }, body: file })
  if (!put.ok) throw new Error("Could not upload your video")
  return data.fileUrl
}

/** One student's self-reflection: read it, add notes, film or type feedback, then send it back or accept it. */
function ReflectionReview({ lessonId, studentId, onClose }: { lessonId: string; studentId: string; onClose: () => void }) {
  const { data, loading } = useFetch<Detail>(`/api/tutor/lessons/${lessonId}/reflections/${studentId}`, {
    errorMessage: "Could not load this self-reflection",
  })
  const [text, setText] = useState("")
  const [videoUrl, setVideoUrl] = useState<string | undefined>()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noting, setNoting] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<"RETURNED" | "COMPLETE" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const back = (
    <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={onClose}>
      <ChevronLeft className="mr-1 size-4" /> All students
    </Button>
  )

  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        {loading
          ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
          : <p className="py-6 text-center text-sm text-muted-foreground">Could not load this self-reflection.</p>}
      </div>
    )
  }

  const { student, criteria, submission } = data
  const status = submission?.status
  const waiting = status === "SUBMITTED"
  const hasFeedback = !!text.trim() || !!videoUrl || Object.values(notes).some((n) => n.trim())
  // The notes the student was last given, while they are still working on them.
  const lastNotes = submission?.feedback[0]?.notes ?? {}

  async function reply(outcome: "RETURNED" | "COMPLETE") {
    if (outcome === "RETURNED" && !hasFeedback) {
      setError("Add some feedback first — type it, film it, or add a note on a section — so the student knows what to change.")
      return
    }
    if (outcome === "COMPLETE" && !window.confirm(`Mark ${student.name}'s self-reflection complete? They won't be able to change it after this.`)) return
    setBusy(outcome)
    setError(null)
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/reflections/${studentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, text, videoUrl: videoUrl ?? null, notes }),
      })
      const d = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(d.message ?? "Could not send it")
      toast.success(outcome === "COMPLETE" ? `Marked complete — ${student.name} has been told` : `Sent back to ${student.name} with your feedback`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send it")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <StudentAvatar student={student} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{student.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {submission?.submittedAt ? `Sent ${dateTime(submission.submittedAt)}` : student.email}
          </p>
        </div>
        {status && <Badge variant="outline" className={STATUS_INFO[status].className}>{STATUS_INFO[status].label}</Badge>}
      </div>

      {!submission || status === "DRAFT" ? (
        <p className="text-sm text-muted-foreground">{student.name} hasn&apos;t sent this yet.</p>
      ) : (
        <>
          {status === "RETURNED" && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              You sent this back. You&apos;ll be told when {student.name} sends it again.
            </p>
          )}

          <ol className="flex flex-col gap-4">
            {criteria.map((c, i) => {
              const number = criterionNumber(c.question, i, c.section)
              const heading = sectionStart(criteria, i) && <SectionHeading title={sectionStart(criteria, i)!} />
              if (c.locked) {
                return (
                  <Fragment key={c.id}>
                  {heading}
                  <li className="rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    {number && <span className="mr-1 font-semibold">{number}</span>}{c.question}
                    <span className="ml-2 text-xs">(not part of this assessment)</span>
                  </li>
                  </Fragment>
                )
              }
              const answer = submission.answers[c.id] ?? ""
              const noteOpen = noting.has(c.id) || !!notes[c.id]
              return (
                <Fragment key={c.id}>
                {heading}
                <li className="flex flex-col gap-2 rounded-xl border p-4">
                  <p className="whitespace-pre-wrap text-sm font-semibold">{number && <span className="mr-1">{number}</span>}{c.question}</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                    {answer || <span className="text-muted-foreground">Nothing written</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{wordCount(answer)} words</p>
                  {!waiting && lastNotes[c.id] && (
                    <p className="whitespace-pre-wrap rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      <span className="font-semibold">Your note: </span>{lastNotes[c.id]}
                    </p>
                  )}
                  {waiting && (noteOpen ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`note-${c.id}`} className="text-xs">Note on this section</Label>
                        <Button variant="ghost" size="icon" className="size-7" aria-label="Remove note"
                          onClick={() => {
                            setNotes((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== c.id)))
                            setNoting((s) => { const n = new Set(s); n.delete(c.id); return n })
                          }}>
                          <X className="size-4" />
                        </Button>
                      </div>
                      <Textarea
                        id={`note-${c.id}`}
                        autoFocus={!notes[c.id]}
                        rows={2}
                        placeholder="e.g. Add more detail about how you prepared."
                        value={notes[c.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="self-start -ml-2 text-primary"
                      onClick={() => setNoting((s) => new Set(s).add(c.id))}>
                      <MessageSquarePlus className="mr-1.5 size-4" /> Add a note
                    </Button>
                  ))}
                </li>
                </Fragment>
              )
            })}
          </ol>

          {waiting && (
            <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4">
              <p className="font-semibold">Your feedback</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reflection-feedback">Type it</Label>
                <Textarea
                  id="reflection-feedback"
                  rows={4}
                  placeholder="What is good, and what to add or change."
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError(null) }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Film it <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <SignAnswerRecorder
                  lessonId={lessonId}
                  videoUrl={videoUrl}
                  maxSeconds={10 * 60}
                  filmLabel="Film your feedback"
                  upload={(file) => uploadFeedbackVideo(lessonId, studentId, file)}
                  onChange={(url) => { setVideoUrl(url); setError(null) }}
                />
                {videoUrl && (
                  <Button variant="ghost" size="sm" className="self-start -ml-2 text-destructive" onClick={() => setVideoUrl(undefined)}>
                    <Trash2 className="mr-1.5 size-4" /> Remove video
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Button onClick={() => reply("RETURNED")} disabled={!!busy}>
                  {busy === "RETURNED" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RotateCcw className="mr-1.5 size-4" />}
                  Send back for changes
                </Button>
                <Button variant="outline" onClick={() => reply("COMPLETE")} disabled={!!busy}
                  className="border-emerald-300 text-emerald-800 hover:bg-emerald-50">
                  {busy === "COMPLETE" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 size-4" />}
                  Mark complete
                </Button>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {submission.feedback.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Feedback given</p>
              {submission.feedback.map((f) => <FeedbackCard key={f.id} item={f} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
