"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
import {
  Video, CalendarPlus, Clock, Users,
  Loader2, Radio, CheckCircle2, XCircle,
  CalendarDays, List, Download, MonitorPlay,
  Sparkles, BookOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

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
  course: { id: string; title: string } | null
  recordingUrl: string | null
  startedAt: string | null
  endedAt: string | null
}

type SessionsData = { sessions: SessionItem[] }

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS = {
  SCHEDULED: {
    label: "Scheduled",
    dot: "bg-amber-400",
    badge: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    card: "border-border hover:border-primary/30",
    icon: Clock,
  },
  LIVE: {
    label: "Live Now",
    dot: "bg-emerald-500 animate-pulse",
    badge: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    card: "border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20",
    icon: Radio,
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-primary/60",
    badge: "border-border text-muted-foreground bg-muted/60",
    card: "border-border opacity-90",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-rose-400",
    badge: "border-rose-200 text-rose-600 bg-rose-50 dark:bg-rose-950 dark:text-rose-300",
    card: "border-border opacity-70",
    icon: XCircle,
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    dateOnly: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    dateKey: d.toDateString(),
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onMutated,
}: {
  session: SessionItem
  onMutated?: () => void
}) {
  const { date, time } = formatDate(session.scheduledAt)
  const cfg = STATUS[session.status]
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
    <div className={cn(
      "rounded-2xl border p-5 flex flex-col gap-4 transition-all hover:shadow-sm",
      cfg.card
    )}>
      {/* Top row */}
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="mt-1 shrink-0">
          <span className={cn("block size-2.5 rounded-full", cfg.dot)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={cn("text-[10px] gap-1 h-5", cfg.badge)}>
              <StatusIcon className="size-3" />
              {cfg.label}
            </Badge>
            {session.course && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <BookOpen className="size-3" />
                {session.course.title}
              </span>
            )}
          </div>

          <h3 className="font-bold text-sm leading-snug">{session.title}</h3>
          {session.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{session.description}</p>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pl-5">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5 shrink-0 text-primary/60" />
          {date}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0 text-primary/60" />
          {time} · {session.durationMins} min
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5 shrink-0 text-primary/60" />
          {session.attendeeCount}{session.maxStudents ? `/${session.maxStudents}` : ""} students
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pl-5">
        {session.status === "SCHEDULED" && (
          <>
            <Button
              size="sm"
              disabled={patching}
              onClick={() => patch({ status: "LIVE" })}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-7 text-xs px-3"
            >
              <Radio className="size-3" /> Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={patching}
              className="text-destructive hover:text-destructive h-7 text-xs px-3"
              onClick={() => patch({ status: "CANCELLED" })}
            >
              Cancel
            </Button>
          </>
        )}

        {session.status === "LIVE" && (
          <>
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-7 text-xs px-3">
              <Link href={`/tutor/sessions/${session.id}/live`}>
                <MonitorPlay className="size-3" /> Open Classroom
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={patching}
              className="h-7 text-xs px-3"
              onClick={() => patch({ status: "COMPLETED" })}
            >
              <CheckCircle2 className="size-3 mr-1" /> End Session
            </Button>
          </>
        )}

        {session.status === "COMPLETED" && session.recordingUrl && (
          <Button asChild size="sm" variant="outline" className="gap-1.5 h-7 text-xs px-3">
            <a href={session.recordingUrl} download target="_blank" rel="noopener noreferrer">
              <Download className="size-3" /> Download Recording
            </a>
          </Button>
        )}

        <Button asChild size="sm" variant="ghost" className="ml-auto h-7 text-xs px-2 text-muted-foreground">
          <Link href={`/tutor/sessions/${session.id}`}>
            View details
          </Link>
        </Button>
      </div>
    </div>
  )
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const [selected, setSelected] = useState<Date | undefined>(new Date())

  // Dates that have at least one session
  const sessionDates = useMemo(
    () => sessions.map((s) => new Date(s.scheduledAt)),
    [sessions]
  )

  const filteredSessions = useMemo(() => {
    if (!selected) return sessions
    return sessions.filter((s) => isSameDay(new Date(s.scheduledAt), selected))
  }, [sessions, selected])

  const selectedLabel = selected
    ? selected.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "All sessions"

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Calendar panel */}
      <div className="shrink-0 rounded-2xl border border-border bg-card p-4 self-start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={setSelected}
          modifiers={{ hasSession: sessionDates }}
          modifiersClassNames={{
            hasSession: "font-bold after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:size-1 after:rounded-full after:bg-primary after:content-['']",
          }}
          className="p-0"
        />
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 text-xs text-muted-foreground h-7"
            onClick={() => setSelected(undefined)}
          >
            Clear — show all
          </Button>
        )}
      </div>

      {/* Session list for selected date */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">
            {selectedLabel}
          </h2>
          {filteredSessions.length > 0 && (
            <Badge variant="secondary" className="text-xs ml-1">
              {filteredSessions.length}
            </Badge>
          )}
        </div>

        {filteredSessions.length > 0 ? (
          <div className="flex flex-col gap-3">
            {filteredSessions.map((s) => (
              <SessionCard key={s.id} session={s} onMutated={onMutated} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-14 flex flex-col items-center gap-3 text-center">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No sessions on this day</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/tutor/sessions/new">
                <CalendarPlus className="size-3.5 mr-1.5" /> Schedule One
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ sessions, onMutated }: { sessions: SessionItem[]; onMutated: () => void }) {
  const live      = sessions.filter((s) => s.status === "LIVE")
  const upcoming  = sessions.filter((s) => s.status === "SCHEDULED")
  const past      = sessions.filter((s) => s.status === "COMPLETED" || s.status === "CANCELLED")

  return (
    <div className="flex flex-col gap-8">
      {live.length > 0 && (
        <Section title="Live Now" dot>
          {live.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)}
        </Section>
      )}

      <Section title="Upcoming">
        {upcoming.length > 0 ? (
          upcoming.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-10 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/tutor/sessions/new">
                <CalendarPlus className="size-3.5 mr-1.5" /> Schedule one
              </Link>
            </Button>
          </div>
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Past Sessions">
          {past.map((s) => <SessionCard key={s.id} session={s} onMutated={onMutated} />)}
        </Section>
      )}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, dot, children }: { title: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        {dot && <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />}
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorSessionsPage() {
  const [view, setView] = useState<"list" | "calendar">("list")

  const { data, loading, refetch } = useFetch<SessionsData>("/api/tutor/sessions", {
    errorMessage: "Could not load sessions",
  })

  const sessions = data?.sessions ?? []

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Video className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Live Sessions</h1>
            <p className="text-sm text-muted-foreground">Manage your BSL live classes</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                view === "list"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="size-3.5" /> List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                view === "calendar"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays className="size-3.5" /> Calendar
            </button>
          </div>

          <Button asChild size="sm">
            <Link href="/tutor/sessions/new">
              <CalendarPlus className="size-4 mr-1.5" /> Schedule Session
            </Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : view === "calendar" ? (
        <CalendarView sessions={sessions} onMutated={refetch} />
      ) : (
        <ListView sessions={sessions} onMutated={refetch} />
      )}
    </div>
  )
}
