"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
import {
  Video, Clock, Users, Radio,
  BookOpen, Loader2, Sparkles,
  CalendarDays, List, Download, CheckCircle2,
  XCircle, ChevronLeft, ChevronRight,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
    chip: "bg-primary/80 text-primary-foreground",
  },
  LIVE: {
    label: "Live Now",
    dot: "bg-emerald-500 animate-pulse",
    badge: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    card: "border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/60 to-background dark:from-emerald-950/20",
    chip: "bg-emerald-500 text-white",
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-muted-foreground/40",
    badge: "border-border text-muted-foreground bg-muted/60",
    card: "border-border opacity-80",
    chip: "bg-muted text-muted-foreground",
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-rose-400",
    badge: "border-rose-200 text-rose-500 bg-rose-50 dark:bg-rose-950",
    card: "border-border opacity-60",
    chip: "bg-rose-100 text-rose-600 dark:bg-rose-900/60 dark:text-rose-300",
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

function buildMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const start = new Date(year, month, 1 - startOffset)
  const weeks: Date[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function TutorAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  return (
    <div className="size-7 rounded-full bg-linear-to-br from-primary/30 to-primary/10 flex items-center justify-center font-bold text-primary text-[10px] shrink-0">
      {initials}
    </div>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: LiveSession }) {
  const cfg = STATUS[session.status]
  const scheduled = new Date(session.scheduledAt)

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all hover:shadow-sm",
      cfg.card
    )}>
      {/* Live banner */}
      {session.status === "LIVE" && (
        <div className="bg-emerald-500 text-white px-4 py-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio className="size-3 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wide">Happening now</span>
          </div>
          <Button asChild size="sm" className="h-6 text-[11px] px-3 bg-white text-emerald-700 hover:bg-white/90 gap-1">
            <Link href={`/student/classroom/${session.id}`}>
              <Radio className="size-2.5" /> Join
            </Link>
          </Button>
        </div>
      )}

      <div className="p-5 flex flex-col gap-4">
        {/* Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant="outline" className={cn("text-xs gap-1", cfg.badge)}>
                {session.status === "COMPLETED" && <CheckCircle2 className="size-3" />}
                {session.status === "CANCELLED" && <XCircle className="size-3" />}
                {cfg.label}
              </Badge>
              {session.course && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <BookOpen className="size-3" />
                  {session.course.title}
                </span>
              )}
            </div>
            <h3 className="font-bold text-base leading-snug">{session.title}</h3>
            {session.description && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{session.description}</p>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Date</p>
            <p className="text-xs font-semibold">
              {scheduled.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Time</p>
            <p className="text-xs font-semibold">
              {scheduled.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Duration</p>
            <p className="text-xs font-semibold">{session.durationMins} min</p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Students</p>
            <p className="text-xs font-semibold">
              {session.attendeeCount}{session.maxStudents ? ` / ${session.maxStudents}` : " joined"}
            </p>
          </div>
        </div>

        {/* Footer: tutor + action */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
          <div className="flex items-center gap-2">
            <TutorAvatar name={session.tutor.name} />
            <div>
              <p className="text-xs font-semibold leading-tight">{session.tutor.name}</p>
              <p className="text-[10px] text-muted-foreground">Tutor</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {session.status === "COMPLETED" && session.recordingUrl && (
              <Button asChild size="sm" variant="outline" className="gap-1.5 h-8">
                <a href={session.recordingUrl} download target="_blank" rel="noopener noreferrer">
                  <Download className="size-3.5" /> Download Recording
                </a>
              </Button>
            )}
            {session.status === "COMPLETED" && !session.recordingUrl && (
              <span className="text-xs text-muted-foreground">No recording available</span>
            )}
            {session.status === "SCHEDULED" && (
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                <Link href={`/student/classroom/${session.id}`}>
                  View Lobby
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Big Calendar View ────────────────────────────────────────────────────────

function BigCalendar({ sessions }: { sessions: LiveSession[] }) {
  const today = useMemo(() => new Date(), [])
  const [current, setCurrent] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date>(today)

  const weeks = useMemo(
    () => buildMonthGrid(current.getFullYear(), current.getMonth()),
    [current]
  )

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, LiveSession[]>()
    for (const s of sessions) {
      const key = new Date(s.scheduledAt).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return map
  }, [sessions])

  const selectedSessions = sessionsByDay.get(selectedDay.toDateString()) ?? []

  const upcomingPreviews = useMemo(() =>
    sessions
      .filter((s) => s.status === "SCHEDULED" || s.status === "LIVE")
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .slice(0, 5),
    [sessions]
  )

  const monthLabel = current.toLocaleDateString("en-GB", { month: "long", year: "numeric" })

  return (
    <div className="flex gap-5 items-start">
      {/* ── Main grid ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Month nav */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7"
              onClick={() => { const d = new Date(current); d.setMonth(d.getMonth() - 1); setCurrent(d) }}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
              onClick={() => { setCurrent(new Date()); setSelectedDay(new Date()) }}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="size-7"
              onClick={() => { const d = new Date(current); d.setMonth(d.getMonth() + 1); setCurrent(d) }}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted-foreground">{d}</div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b last:border-b-0 border-border">
              {week.map((day, di) => {
                const isThisMonth = day.getMonth() === current.getMonth()
                const isToday = isSameDay(day, today)
                const isSelected = isSameDay(day, selectedDay)
                const daySessions = sessionsByDay.get(day.toDateString()) ?? []

                return (
                  <div
                    key={di}
                    onClick={() => setSelectedDay(new Date(day))}
                    className={cn(
                      "min-h-22.5 p-1.5 border-r last:border-r-0 border-border cursor-pointer transition-colors group",
                      isThisMonth ? "bg-background" : "bg-muted/15",
                      isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      !isSelected && "hover:bg-muted/30"
                    )}
                  >
                    <div className="flex justify-end mb-1">
                      <span className={cn(
                        "size-6 flex items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                        isToday && "bg-primary text-primary-foreground",
                        !isToday && isThisMonth && "text-foreground group-hover:text-primary",
                        !isToday && !isThisMonth && "text-muted-foreground/40"
                      )}>
                        {day.getDate()}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {daySessions.slice(0, 3).map((s) => (
                        <div key={s.id} className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded-md truncate leading-tight",
                          STATUS[s.status].chip
                        )}>
                          {formatTime(s.scheduledAt)} {s.title}
                        </div>
                      ))}
                      {daySessions.length > 3 && (
                        <span className="text-[9px] text-muted-foreground pl-1 font-medium">
                          +{daySessions.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {selectedSessions.length > 0 && (
          <div className="flex flex-col gap-3 pt-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <CalendarDays className="size-3.5" />
              {selectedDay.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              <Badge variant="secondary" className="text-xs">{selectedSessions.length}</Badge>
            </h3>
            {selectedSessions.map((s) => <SessionCard key={s.id} session={s} />)}
          </div>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div className="w-60 shrink-0 flex flex-col gap-4">
        {/* Selected day */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className={cn(
            "px-4 py-3 border-b border-border",
            isSameDay(selectedDay, today) ? "bg-primary/5" : "bg-muted/30"
          )}>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              {isSameDay(selectedDay, today) ? "Today" : selectedDay.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })}
            </p>
            <p className="text-2xl font-black tabular-nums leading-none mt-0.5">
              {selectedDay.getDate()}
            </p>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {selectedSessions.length > 0 ? (
              selectedSessions.map((s) => (
                <div key={s.id} className="flex items-start gap-2">
                  <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.tutor.name} · {formatTime(s.scheduledAt)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground text-center py-3">No sessions</p>
            )}
          </div>
        </div>

        {/* Upcoming */}
        {upcomingPreviews.length > 0 && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Upcoming</p>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {upcomingPreviews.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const d = new Date(s.scheduledAt)
                    setCurrent(new Date(d.getFullYear(), d.getMonth(), 1))
                    setSelectedDay(d)
                  }}
                  className="flex items-start gap-2 text-left w-full hover:bg-muted/40 rounded-lg p-1.5 -mx-1.5 transition-colors group"
                >
                  <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(s.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {" · "}{s.tutor.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Summary</p>
          {(["LIVE", "SCHEDULED", "COMPLETED"] as const).map((status) => {
            const count = sessions.filter((s) => s.status === status).length
            if (!count) return null
            const cfg = STATUS[status]
            return (
              <div key={status} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", cfg.dot.replace("animate-pulse", ""))} />
                  <span className="text-xs text-muted-foreground">{cfg.label}</span>
                </div>
                <span className="text-xs font-bold tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Shared Sidebar ───────────────────────────────────────────────────────────

function SessionsSidebar({ sessions }: { sessions: LiveSession[] }) {
  const today = new Date()
  const todaySessions = sessions.filter((s) => isSameDay(new Date(s.scheduledAt), today))
  const upcomingPreviews = sessions
    .filter((s) => s.status === "SCHEDULED" || s.status === "LIVE")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 5)

  return (
    <div className="w-64 shrink-0 flex flex-col gap-4">
      {/* Today */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-primary/5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Today</p>
          <p className="text-2xl font-black tabular-nums leading-none mt-0.5">{today.getDate()}</p>
          <p className="text-xs text-muted-foreground">
            {today.toLocaleDateString("en-GB", { weekday: "long", month: "short" })}
          </p>
        </div>
        <div className="p-3 flex flex-col gap-2">
          {todaySessions.length > 0 ? (
            todaySessions.map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">{s.tutor.name} · {formatTime(s.scheduledAt)}</p>
                </div>
                <Badge variant="outline" className={cn("text-[9px] px-1 h-4 shrink-0", STATUS[s.status].badge)}>
                  {STATUS[s.status].label}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">No sessions today</p>
          )}
        </div>
      </div>

      {/* Upcoming */}
      {upcomingPreviews.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Upcoming</p>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {upcomingPreviews.map((s) => (
              <div key={s.id} className="flex items-start gap-2 rounded-lg p-1.5 -mx-1.5">
                <div className={cn("w-0.5 self-stretch rounded-full shrink-0 mt-0.5", STATUS[s.status].dot.replace("animate-pulse", ""))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" · "}{s.tutor.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Summary</p>
        {(["LIVE", "SCHEDULED", "COMPLETED"] as const).map((status) => {
          const count = sessions.filter((s) => s.status === status).length
          if (!count) return null
          const cfg = STATUS[status]
          return (
            <div key={status} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", cfg.dot.replace("animate-pulse", ""))} />
                <span className="text-xs text-muted-foreground">{cfg.label}</span>
              </div>
              <span className="text-xs font-bold tabular-nums">{count}</span>
            </div>
          )
        })}
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">No sessions yet.</p>
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
    <div className="flex gap-5 items-start">
      {/* Main list */}
      <div className="flex-1 min-w-0 flex flex-col gap-8">
        {live.length > 0 && (
          <Section title="Live Now" dot>
            {live.map((s) => <SessionCard key={s.id} session={s} />)}
          </Section>
        )}
        <Section title="Upcoming Sessions">
          {upcoming.length > 0 ? (
            upcoming.map((s) => <SessionCard key={s.id} session={s} />)
          ) : (
            <div className="rounded-2xl border border-dashed py-14 flex flex-col items-center gap-3 text-center">
              <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
                <Sparkles className="size-5 text-muted-foreground" />
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

      {/* Sidebar — same layout as calendar */}
      <SessionsSidebar sessions={sessions} />
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
    <div className="flex flex-col gap-6">
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

        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-muted/40 p-1">
          <button
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              view === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="size-3.5" /> List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              view === "calendar" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
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
        <BigCalendar sessions={sessions} />
      ) : (
        <ListView sessions={sessions} />
      )}
    </div>
  )
}
