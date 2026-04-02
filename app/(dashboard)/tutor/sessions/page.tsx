"use client"

import Link from "next/link"
import {
  Video, CalendarPlus, Clock, Users, ChevronRight,
  Loader2, Radio, CheckCircle2, XCircle, Calendar,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionItem = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  attendeeCount: number
  maxStudents: number | null
  courseTitle: string | null
}

type SessionsData = { sessions: SessionItem[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusConfig = {
  SCHEDULED: { label: "Scheduled", className: "bg-amber-100 text-amber-700 border-amber-200", icon: Calendar },
  LIVE:      { label: "Live",      className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Radio },
  COMPLETED: { label: "Completed", className: "bg-muted text-muted-foreground", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", className: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle },
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorSessionsPage() {
  const { data, loading, refetch } = useFetch<SessionsData>("/api/tutor/sessions", {
    errorMessage: "Could not load sessions",
  })

  const live     = data?.sessions.filter((s) => s.status === "LIVE") ?? []
  const upcoming = data?.sessions.filter((s) => s.status === "SCHEDULED") ?? []
  const past     = data?.sessions.filter((s) => s.status === "COMPLETED" || s.status === "CANCELLED") ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Video className="size-6 text-primary" /> Live Sessions
          </h1>
          <p className="text-muted-foreground mt-1">Manage your scheduled and past BSL sessions.</p>
        </div>
        <Button asChild>
          <Link href="/tutor/sessions/new">
            <CalendarPlus className="size-4 mr-1.5" /> Schedule Session
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {live.length > 0 && (
            <Section title="Live Now" dot>
              {live.map((s) => <SessionRow key={s.id} session={s} onMutated={refetch} />)}
            </Section>
          )}

          <Section title="Upcoming">
            {upcoming.length > 0 ? (
              upcoming.map((s) => <SessionRow key={s.id} session={s} onMutated={refetch} />)
            ) : (
              <Card className="shadow-sm border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No upcoming sessions.{" "}
                  <Link href="/tutor/sessions/new" className="text-primary underline underline-offset-2">
                    Schedule one
                  </Link>
                </CardContent>
              </Card>
            )}
          </Section>

          {past.length > 0 && (
            <Section title="Past Sessions">
              {past.map((s) => <SessionRow key={s.id} session={s} readonly />)}
            </Section>
          )}
        </>
      )}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, dot, children }: { title: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
        {dot && <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />}
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

// ─── Session row — has its own mutation hook ──────────────────────────────────

function SessionRow({
  session,
  readonly = false,
  onMutated,
}: {
  session: SessionItem
  readonly?: boolean
  onMutated?: () => void
}) {
  const { date, time } = formatDate(session.scheduledAt)
  const cfg = statusConfig[session.status]
  const StatusIcon = cfg.icon

  const { execute: patch, loading: patching } = usePatchCallback<
    { session: SessionItem },
    { status: "LIVE" | "COMPLETED" | "CANCELLED" }
  >(`/api/tutor/sessions/${session.id}`, {
    successMessage: (d) =>
      `Session ${(d as { session: { status: string } }).session.status.toLowerCase()}`,
    errorMessage: "Could not update session",
    onSuccess: () => onMutated?.(),
  })

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge variant="outline" className={`text-xs gap-1 ${cfg.className}`}>
                <StatusIcon className="size-3" />
                {cfg.label}
              </Badge>
              {session.courseTitle && (
                <span className="text-xs text-muted-foreground">· {session.courseTitle}</span>
              )}
            </div>
            <p className="font-semibold leading-snug">{session.title}</p>

            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {date} · {time}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {session.durationMins} min
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {session.attendeeCount}{session.maxStudents ? `/${session.maxStudents}` : ""} joined
              </span>
            </div>
          </div>

          {!readonly && (
            <div className="flex gap-2 shrink-0">
              {session.status === "SCHEDULED" && (
                <>
                  <Button
                    size="sm"
                    disabled={patching}
                    onClick={() => patch({ status: "LIVE" })}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Radio className="size-3.5 mr-1.5" /> Start
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={patching}
                    className="text-destructive hover:text-destructive"
                    onClick={() => patch({ status: "CANCELLED" })}
                  >
                    Cancel
                  </Button>
                </>
              )}
              {session.status === "LIVE" && (
                <Button size="sm" variant="outline" disabled={patching} onClick={() => patch({ status: "COMPLETED" })}>
                  <CheckCircle2 className="size-3.5 mr-1.5" /> End Session
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/tutor/sessions/${session.id}`}>
                  <ChevronRight className="size-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
