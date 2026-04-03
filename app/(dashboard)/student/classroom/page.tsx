"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
import {
  Video, Clock, Users, Radio,
  BookOpen, Loader2, ChevronRight, Sparkles,
  CalendarDays, List, Download, CheckCircle2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type LiveSession = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  maxStudents: number | null
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  tutor: { id: string; name: string; avatarUrl: string | null }
  course: { id: string; title: string } | null
  attendeeCount: number
  recordingUrl: string | null
}

type SessionsData = { sessions: LiveSession[] }

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS = {
  SCHEDULED: {
    label: "Scheduled",
    dot: "bg-amber-400",
    badge: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    card: "border-border hover:border-primary/30",
  },
  LIVE: {
    label: "Live Now",
    dot: "bg-emerald-500 animate-pulse",
    badge: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    card: "border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/60 to-background dark:from-emerald-950/20",
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-primary/60",
    badge: "border-border text-muted-foreground bg-muted/60",
    card: "border-border opacity-80",
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-rose-400",
    badge: "border-rose-200 text-rose-500 bg-rose-50 dark:bg-rose-950",
    card: "border-border opacity-60",
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function TutorAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  return (
    <div className="size-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center font-bold text-primary text-xs shrink-0">
      {initials}
    </div>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: LiveSession }) {
  const { date, time } = formatDate(session.scheduledAt)
  const cfg = STATUS[session.status]

  return (
    <div className={cn(
      "rounded-2xl border p-5 flex flex-col gap-4 transition-all hover:shadow-sm",
      cfg.card
    )}>
      {/* Top row */}
      <div className="flex items-start gap-3">
        <span className={cn("block size-2.5 rounded-full mt-1 shrink-0", cfg.dot)} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={cn("text-[10px] h-5 gap-1", cfg.badge)}>
              {session.status === "LIVE" && (
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              )}
              {session.status === "COMPLETED" && <CheckCircle2 className="size-3" />}
              {session.status === "CANCELLED" && <XCircle className="size-3" />}
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

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pl-5">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5 text-primary/60" />
          {date}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-primary/60" />
          {time} · {session.durationMins} min
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5 text-primary/60" />
          {session.attendeeCount}{session.maxStudents ? `/${session.maxStudents}` : ""} students
        </span>
      </div>

      {/* Tutor + action */}
      <div className="flex items-center justify-between gap-3 pl-5 pt-1 border-t border-border/50">
        <div className="flex items-center gap-2">
          <TutorAvatar name={session.tutor.name} />
          <div>
            <p className="text-xs font-semibold leading-none">{session.tutor.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Tutor</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session.status === "LIVE" && (
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-7 text-xs px-3">
              <Link href={`/student/classroom/${session.id}`}>
                <Radio className="size-3 animate-pulse" /> Join Now
              </Link>
            </Button>
          )}
          {session.status === "SCHEDULED" && (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs px-3">
              <Link href={`/student/classroom/${session.id}`}>
                <ChevronRight className="size-3.5" /> View
              </Link>
            </Button>
          )}
          {session.status === "COMPLETED" && session.recordingUrl && (
            <Button asChild size="sm" variant="outline" className="gap-1.5 h-7 text-xs px-3">
              <a href={session.recordingUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="size-3" /> Recording
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({ sessions }: { sessions: LiveSession[] }) {
  const [selected, setSelected] = useState<Date | undefined>(new Date())

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
      {/* Calendar */}
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

      {/* Sessions for selected date */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">
            {selectedLabel}
          </h2>
          {filteredSessions.length > 0 && (
            <Badge variant="secondary" className="text-xs ml-1">{filteredSessions.length}</Badge>
          )}
        </div>

        {filteredSessions.length > 0 ? (
          <div className="flex flex-col gap-3">
            {filteredSessions.map((s) => <SessionCard key={s.id} session={s} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-14 flex flex-col items-center gap-3 text-center">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No sessions on this day</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ sessions }: { sessions: LiveSession[] }) {
  const live      = sessions.filter((s) => s.status === "LIVE")
  const upcoming  = sessions.filter((s) => s.status === "SCHEDULED")
  const completed = sessions.filter((s) => s.status === "COMPLETED")

  return (
    <div className="flex flex-col gap-8">
      {live.length > 0 && (
        <Section title="Live Now" dot>
          {live.map((s) => <SessionCard key={s.id} session={s} />)}
        </Section>
      )}

      <Section title="Upcoming Sessions">
        {upcoming.length > 0 ? (
          upcoming.map((s) => <SessionCard key={s.id} session={s} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 py-14 flex flex-col items-center gap-4 text-center">
            <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
              <Sparkles className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-sm">No upcoming sessions</p>
              <p className="text-xs text-muted-foreground mt-1">Your tutor hasn&apos;t scheduled any classes yet.</p>
            </div>
          </div>
        )}
      </Section>

      {completed.length > 0 && (
        <Section title="Past Sessions">
          {completed.map((s) => <SessionCard key={s.id} session={s} />)}
        </Section>
      )}
    </div>
  )
}

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

export default function ClassroomPage() {
  const [view, setView] = useState<"list" | "calendar">("list")

  const { data, loading } = useFetch<SessionsData>("/api/sessions", {
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
            <h1 className="text-2xl font-black tracking-tight">Live Classroom</h1>
            <p className="text-sm text-muted-foreground">Join live BSL sessions with your tutors</p>
          </div>
        </div>

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
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="size-7 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        </div>
      ) : view === "calendar" ? (
        <CalendarView sessions={sessions} />
      ) : (
        <ListView sessions={sessions} />
      )}
    </div>
  )
}
