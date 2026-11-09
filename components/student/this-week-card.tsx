"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowRight, CalendarPlus, CheckCircle2, ChevronRight,
  PlayCircle, Radio, Video, BookOpen, Sparkles, MapPin,
} from "lucide-react"
import { LESSON_KINDS } from "@/lib/lesson-kind"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { RecordingButton } from "@/components/sessions/recording-button"
import { downloadIcs } from "@/lib/ics"
import { VenueLink } from "@/components/sessions/face-to-face"

export type ThisWeek = {
  nextClass: {
    id: string
    title: string
    scheduledAt: string
    durationMins: number
    tutorName: string
    status: string
    inPerson: boolean
    venue: string | null
  } | null
  homework: Array<{ id: string; title: string; type: string; courseTitle: string; isNew: boolean }>
  homeworkLeft: number
  lastRecording: { id: string; title: string; scheduledAt: string } | null
}


// The classroom opens a few minutes early so students can check camera and sound.
const JOIN_EARLY_MS = 15 * 60 * 1000

/** "Today, 16:45" · "Tomorrow, 16:45" · "Mon 20 Oct, 16:45" */
function whenLabel(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`
}

/** The current time, refreshed every minute — so "Join" appears when the class opens. */
function useMinuteClock() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 60_000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [])
  return now
}

/**
 * The student home page's main card: everything a weekly-class student needs
 * this week — their next class, the lessons to do, and last class's recording.
 */
export function ThisWeekCard({ data, loading, hasCourse }: {
  data: ThisWeek | null
  loading: boolean
  hasCourse: boolean
}) {
  const now = useMinuteClock()

  if (loading || !data) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="h-5 w-28 bg-muted rounded animate-pulse" />
          <div className="h-16 w-full bg-muted rounded-xl animate-pulse" />
          <div className="h-24 w-full bg-muted rounded-xl animate-pulse" />
        </CardContent>
      </Card>
    )
  }

  const { nextClass, homework, homeworkLeft, lastRecording } = data
  const inPerson = !!nextClass?.inPerson
  // A face-to-face class is never "live" here: there is no room to join.
  const isLive = !inPerson && nextClass?.status === "LIVE"
  const canJoin = !!nextClass && !inPerson && (isLive || (now !== null && new Date(nextClass.scheduledAt).getTime() - now < JOIN_EARLY_MS))

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-black tracking-tight">This week</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">

        {/* ── Next class ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Your next class</h3>
          {nextClass ? (
            <div className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${isLive ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30" : "bg-muted/30"}`}>
              <div className={`rounded-full p-2.5 shrink-0 self-start sm:self-center ${isLive ? "bg-emerald-100 text-emerald-700" : inPerson ? "bg-orange-100 text-orange-700" : "bg-primary/10 text-primary"}`}>
                {isLive ? <Radio className="size-5 animate-pulse" /> : inPerson ? <MapPin className="size-5" /> : <Video className="size-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold leading-snug">{nextClass.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isLive ? <span className="font-semibold text-emerald-700">Live now</span> : whenLabel(nextClass.scheduledAt)}
                  {" · "}{nextClass.tutorName}
                </p>
                {inPerson && <VenueLink venue={nextClass.venue} className="text-sm mt-1" />}
              </div>
              <div className="flex gap-2 shrink-0">
                {canJoin ? (
                  <Button asChild size="sm" className={isLive ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}>
                    <Link href={`/student/classroom/${nextClass.id}`}>
                      <Video className="size-3.5 mr-1.5" /> Join class
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadIcs({
                      id: nextClass.id,
                      title: nextClass.title,
                      start: new Date(nextClass.scheduledAt),
                      durationMins: nextClass.durationMins,
                      url: `${window.location.origin}/student/classroom/${nextClass.id}`,
                      description: `BSL class with ${nextClass.tutorName}`,
                      location: nextClass.venue,
                    })}
                  >
                    <CalendarPlus className="size-3.5 mr-1.5" /> Add to calendar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-xl border border-dashed px-4 py-3">
              No class booked for you yet — it will show here as soon as it is.
            </p>
          )}
        </section>

        <Separator />

        {/* ── Homework ───────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Homework</h3>
          {homework.length > 0 ? (
            <div className="flex flex-col divide-y rounded-xl border overflow-hidden">
              {homework.map((lesson) => {
                const Icon = LESSON_KINDS[lesson.type]?.Icon ?? PlayCircle
                return (
                  <Link
                    key={lesson.id}
                    href={`/student/lessons/${lesson.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <Icon className="size-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{lesson.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{lesson.courseTitle}</p>
                    </div>
                    {lesson.isNew && (
                      <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0">New</Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </Link>
                )
              })}
            </div>
          ) : hasCourse ? (
            <p className="text-sm flex items-center gap-2 rounded-xl border px-4 py-3 text-emerald-700">
              <CheckCircle2 className="size-4 shrink-0" /> All caught up — nice work!
            </p>
          ) : (
            <div className="rounded-xl border border-dashed px-4 py-3 flex items-center gap-3">
              <BookOpen className="size-4 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground flex-1">
                No homework yet. It will appear here once your teacher adds you to a course.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {homeworkLeft > homework.length ? (
              <Link href="/student/lessons" className="text-xs font-semibold text-primary flex items-center gap-1">
                {homeworkLeft - homework.length} more after these <ArrowRight className="size-3" />
              </Link>
            ) : <span />}
            {hasCourse && (
              <Link href="/student/dictionary/this-week" className="text-xs font-semibold text-primary flex items-center gap-1">
                <Sparkles className="size-3" /> Practise this week&apos;s signs
              </Link>
            )}
          </div>
        </section>

        {/* ── Last class's recording ─────────────────────────────────── */}
        {lastRecording && (
          <>
            <Separator />
            <section className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Missed something?</h3>
                <p className="text-sm mt-1">
                  <span className="font-semibold">{lastRecording.title}</span>
                  <span className="text-muted-foreground"> · {whenLabel(lastRecording.scheduledAt).split(",")[0]}</span>
                </p>
              </div>
              <RecordingButton
                sessionId={lastRecording.id}
                title={lastRecording.title}
                size="sm"
                variant="outline"
                className="shrink-0 self-start sm:self-center"
              />
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}
