"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle, Check, CheckCircle2, ChevronRight, Clock, Loader2, Lock, MessageSquareText, Send,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { REFLECTION_MAX_CHARS, wordCount } from "@/lib/quiz"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReflectionStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "COMPLETE"

export type ReflectionCriterion = { id: string; question: string; locked: boolean; section?: string | null }

export type ReflectionFeedbackItem = {
  id: string
  outcome: "RETURNED" | "COMPLETE"
  text: string | null
  videoUrl: string | null
  notes: Record<string, string>
  createdAt: string
  authorName: string | null
}

type Data = {
  title: string
  candidate: string
  instructions: string | null
  criteria: ReflectionCriterion[]
  submission: {
    status: ReflectionStatus
    answers: Record<string, string>
    submittedAt: string | null
    updatedAt: string
    feedback: ReflectionFeedbackItem[]
  } | null
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

// ─── Shared pieces (the teacher's screen uses them too) ──────────────────────

export const STATUS_INFO: Record<ReflectionStatus | "NONE", { label: string; className: string }> = {
  NONE: { label: "Not started", className: "bg-muted text-muted-foreground border-transparent" },
  DRAFT: { label: "Writing", className: "bg-slate-100 text-slate-700 border-slate-200" },
  SUBMITTED: { label: "Waiting for teacher", className: "bg-amber-100 text-amber-800 border-amber-200" },
  RETURNED: { label: "Sent back", className: "bg-sky-100 text-sky-800 border-sky-200" },
  COMPLETE: { label: "Complete", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
}

/** A teacher's feedback: what they typed and what they filmed. */
export function FeedbackCard({ item, highlight = false }: { item: ReflectionFeedbackItem; highlight?: boolean }) {
  const complete = item.outcome === "COMPLETE"
  return (
    <div className={cn(
      "flex flex-col gap-3 rounded-xl border p-4",
      highlight && (complete ? "border-emerald-200 bg-emerald-50/60" : "border-sky-200 bg-sky-50/60"),
    )}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        {complete ? <CheckCircle2 className="size-4 text-emerald-600" /> : <MessageSquareText className="size-4 text-sky-700" />}
        {complete ? "Marked complete" : "Sent back with feedback"}
        <span className="text-xs font-normal text-muted-foreground">
          {item.authorName ? `${item.authorName} · ` : ""}{dateTime(item.createdAt)}
        </span>
      </p>
      {item.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</p>}
      {item.videoUrl && (
        <ProtectedVideo src={item.videoUrl} controls playsInline className="w-full max-w-xl max-h-80 rounded-lg border bg-black" />
      )}
      {Object.keys(item.notes).length > 0 && (
        <p className="text-xs text-muted-foreground">There are notes on some sections below.</p>
      )}
    </div>
  )
}

/**
 * "1." … in front of a criterion, unless it is numbered or lettered already
 * ("1.1 Describe …", "a. Use …") or sits under a heading.
 */
export function criterionNumber(question: string, index: number, section?: string | null): string | null {
  return section || /^\s*(\d|[a-z][.)]\s)/i.test(question) ? null : `${index + 1}.`
}

/** The heading to show before criterion `i`: its section, where that changes from the one before. */
export function sectionStart(list: ReadonlyArray<{ section?: string | null }>, i: number): string | null {
  const section = list[i].section?.trim()
  return section && (i === 0 || list[i - 1].section?.trim() !== section) ? section : null
}

/** A section's heading, inside the list of criteria. */
export function SectionHeading({ title }: { title: string }) {
  return (
    <li role="presentation" className="pt-3 first:pt-0">
      <h3 className="border-b pb-1.5 text-base font-bold">{title}</h3>
    </li>
  )
}

// ─── The student's document ───────────────────────────────────────────────────

/**
 * A self-reflection as the student writes it: one box per criterion the
 * teacher picked, the others greyed out. It saves as they type. "Send to my
 * teacher" only goes once every open box has something in it; otherwise the
 * empty ones are pointed out.
 */
export function ReflectionTaker({ lessonId, onCompleted, nextHref }: {
  lessonId: string
  onCompleted: () => void
  nextHref?: string
}) {
  const { data, loading, refetch } = useFetch<Data>(`/api/student/lessons/${lessonId}/reflection`, {
    errorMessage: "Could not load your self-reflection",
  })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(answers)
  latest.current = answers

  // Starts from what is saved.
  useEffect(() => {
    if (!data || loaded) return
    setAnswers(data.submission?.answers ?? {})
    setLoaded(true)
    if (data.submission?.status === "COMPLETE") onCompleted()
  }, [data, loaded, onCompleted])

  const status: ReflectionStatus = data?.submission?.status ?? "DRAFT"
  const editable = status === "DRAFT" || status === "RETURNED"

  async function saveNow(): Promise<boolean> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (!dirty.current) return true
    dirty.current = false
    setSaveState("saving")
    try {
      const res = await fetch(`/api/student/lessons/${lessonId}/reflection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: latest.current }),
      })
      if (!res.ok) throw new Error()
      setSaveState("saved")
      return true
    } catch {
      dirty.current = true
      setSaveState("error")
      return false
    }
  }

  // Saved a moment after they stop typing, and when they leave the page.
  useEffect(() => {
    const flush = () => { if (dirty.current) void saveNow() }
    window.addEventListener("pagehide", flush)
    return () => { window.removeEventListener("pagehide", flush); flush() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function write(id: string, text: string) {
    setAnswers((a) => ({ ...a, [id]: text }))
    if (text.trim()) setMissing((m) => { if (!m.has(id)) return m; const n = new Set(m); n.delete(id); return n })
    setError(null)
    dirty.current = true
    setSaveState("idle")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveNow(), 1200)
  }

  if (!data) {
    return loading
      ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      : <p className="py-6 text-center text-sm text-muted-foreground">This self-reflection could not be loaded.</p>
  }

  // Writing as soon as anything is typed, before the first save comes back.
  const shownStatus = data.submission || Object.values(answers).some((t) => t.trim()) ? status : "NONE"
  const open = data.criteria.filter((c) => !c.locked)
  const done = open.filter((c) => answers[c.id]?.trim()).length
  const latestFeedback = data.submission?.feedback[0]
  const olderFeedback = data.submission?.feedback.slice(1) ?? []
  // Notes on single sections, from the teacher's latest feedback.
  const notes = latestFeedback?.notes ?? {}

  async function send() {
    const empty = open.filter((c) => !answers[c.id]?.trim())
    if (empty.length > 0) {
      setMissing(new Set(empty.map((c) => c.id)))
      setError(`Fill in every section before you send it — ${empty.length} still empty.`)
      document.getElementById(`criterion-${empty[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    if (!window.confirm("Send this to your teacher? You can't change it again until they send it back.")) return
    setSending(true)
    setError(null)
    try {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      dirty.current = false
      const res = await fetch(`/api/student/lessons/${lessonId}/reflection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      })
      const d = await res.json().catch(() => ({})) as { message?: string; missing?: string[] }
      if (!res.ok) {
        if (d.missing) setMissing(new Set(d.missing))
        throw new Error(d.message ?? "Could not send it. Try again.")
      }
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send it. Try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Where it is */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Self-reflection</h2>
          <Badge variant="outline" className={STATUS_INFO[shownStatus].className}>
            {STATUS_INFO[shownStatus].label}
          </Badge>
        </div>
        {editable && open.length > 0 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {saveState === "saving" ? "Saving…"
              : saveState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="size-3.5" /> Saved</span>
              : saveState === "error" ? <span className="text-destructive">Not saved — check your connection</span>
              : null}
          </p>
        )}
      </div>

      <p className="-mt-3 text-xs text-muted-foreground">
        Candidate: <span className="font-medium text-foreground">{data.candidate}</span>
        {data.submission?.submittedAt && <> · last sent {dateTime(data.submission.submittedAt)}</>}
      </p>

      {status === "SUBMITTED" && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Clock className="mt-0.5 size-4 shrink-0" />
          Sent to your teacher{data.submission?.submittedAt ? ` on ${dateTime(data.submission.submittedAt)}` : ""}. You&apos;ll get a notification when they reply.
        </p>
      )}

      {latestFeedback && status !== "SUBMITTED" && (
        <div className="flex flex-col gap-2">
          {status === "RETURNED" && (
            <p className="text-sm font-medium">Your teacher has sent this back. Read their feedback, make your changes, and send it again.</p>
          )}
          <FeedbackCard item={latestFeedback} highlight />
        </div>
      )}

      {data.instructions && (
        <p className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-sm">{data.instructions}</p>
      )}

      {open.length === 0 && (
        <p className="text-sm text-muted-foreground">There is nothing to fill in yet. Your teacher hasn&apos;t picked the criteria for this assessment.</p>
      )}

      {/* The sections */}
      <ol className="flex flex-col gap-4">
        {data.criteria.map((c, i) => {
          const number = criterionNumber(c.question, i, c.section)
          const heading = sectionStart(data.criteria, i)
          const text = answers[c.id] ?? ""
          const isMissing = missing.has(c.id)
          if (c.locked) {
            return (
              <Fragment key={c.id}>
              {heading && <SectionHeading title={heading} />}
              <li className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 p-4 text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm">{number && <span className="mr-1 font-semibold">{number}</span>}{c.question}</p>
                  <p className="mt-1 text-xs">Not part of this assessment</p>
                </div>
              </li>
              </Fragment>
            )
          }
          return (
            <Fragment key={c.id}>
            {heading && <SectionHeading title={heading} />}
            <li id={`criterion-${c.id}`} className={cn(
              "flex flex-col gap-2 rounded-xl border p-4 scroll-mt-24",
              isMissing && "border-destructive/60 bg-destructive/5",
            )}>
              <p className="whitespace-pre-wrap text-sm font-semibold">
                {number && <span className="mr-1">{number}</span>}{c.question}
              </p>
              {notes[c.id] && (
                <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0" />
                  <span className="whitespace-pre-wrap"><span className="font-semibold">Teacher: </span>{notes[c.id]}</span>
                </p>
              )}
              {editable ? (
                <>
                  <Textarea
                    aria-label={c.question}
                    value={text}
                    maxLength={REFLECTION_MAX_CHARS}
                    onChange={(e) => write(c.id, e.target.value)}
                    onBlur={() => void saveNow()}
                    placeholder="Candidate comments…"
                    className="min-h-36 text-sm leading-relaxed field-sizing-content"
                  />
                  <p className={cn("flex items-center gap-1 text-xs", isMissing ? "text-destructive" : "text-muted-foreground")}>
                    {isMissing && <AlertCircle className="size-3.5" />}
                    {isMissing ? "This section is empty" : `${wordCount(text)} word${wordCount(text) === 1 ? "" : "s"}`}
                  </p>
                </>
              ) : (
                <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm leading-relaxed">{text || "—"}</p>
              )}
            </li>
            </Fragment>
          )
        })}
      </ol>

      {/* Send */}
      {editable && open.length > 0 && (
        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <span className={cn("font-semibold", done === open.length ? "text-emerald-700" : "text-foreground")}>{done} of {open.length}</span> sections written
          </p>
          <Button onClick={send} disabled={sending} className="sm:min-w-52">
            {sending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
            {status === "RETURNED" ? "Send back to my teacher" : "Send to my teacher"}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {status === "COMPLETE" && nextHref && (
        <Button asChild className="self-start">
          <Link href={nextHref}>Continue <ChevronRight className="ml-1 size-4" /></Link>
        </Button>
      )}

      {olderFeedback.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-semibold">Earlier feedback ({olderFeedback.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {olderFeedback.map((f) => <FeedbackCard key={f.id} item={f} />)}
          </div>
        </details>
      )}
    </div>
  )
}
