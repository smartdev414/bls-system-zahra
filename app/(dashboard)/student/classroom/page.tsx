"use client"

import Link from "next/link"
import {
  Video, Calendar, Clock, Users, ChevronRight,
  Loader2, Radio, BookOpen,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useFetch } from "@/hooks/use-fetch"

// ─── Types ────────────────────────────────────────────────────────────────────

type LiveSession = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  roomName: string
  maxStudents: number | null
  status: "SCHEDULED" | "LIVE"
  tutor: { id: string; name: string; avatarUrl: string | null }
  course: { id: string; title: string } | null
  attendeeCount: number
}

type SessionsData = { sessions: LiveSession[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClassroomPage() {
  const { data, loading } = useFetch<SessionsData>("/api/sessions", {
    errorMessage: "Could not load sessions",
  })

  const liveSessions = data?.sessions.filter((s) => s.status === "LIVE") ?? []
  const upcomingSessions = data?.sessions.filter((s) => s.status === "SCHEDULED") ?? []

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Video className="size-6 text-primary" />
          Live Classroom
        </h1>
        <p className="text-muted-foreground mt-1">
          Join live BSL sessions with your tutors.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Live now */}
          {liveSessions.length > 0 && (
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Now
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {liveSessions.map((session) => (
                  <SessionCard key={session.id} session={session} live />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              <Calendar className="size-3.5" />
              Upcoming Sessions
            </h2>

            {upcomingSessions.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {upcomingSessions.map((session) => (
                  <SessionCard key={session.id} session={session} live={false} />
                ))}
              </div>
            ) : (
              <Card className="shadow-sm">
                <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                  <div className="rounded-full bg-muted p-5">
                    <Calendar className="size-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">No upcoming sessions</p>
                    <p className="text-sm text-muted-foreground mt-1">Check back later for scheduled classes.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({ session, live }: { session: LiveSession; live: boolean }) {
  const { date, time } = formatDate(session.scheduledAt)

  return (
    <Card className={`shadow-sm overflow-hidden ${live ? "border-emerald-300 ring-1 ring-emerald-200" : ""}`}>
      {live && (
        <div className="bg-emerald-500 text-white px-4 py-1.5 flex items-center gap-2">
          <Radio className="size-3.5 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wide">Session in progress</span>
        </div>
      )}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug">{session.title}</CardTitle>
          {live ? (
            <Badge className="shrink-0 bg-emerald-500 text-white">Live</Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-xs">Scheduled</Badge>
          )}
        </div>
        {session.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{session.description}</p>
        )}
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Meta */}
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="size-3.5 shrink-0" />
            <span>{date}</span>
            <Clock className="size-3.5 shrink-0 ml-1" />
            <span>{time}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" />
            <span>{session.durationMins} min session</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" />
            <span>
              {session.attendeeCount} joined
              {session.maxStudents ? ` · max ${session.maxStudents}` : ""}
            </span>
          </div>
          {session.course && (
            <div className="flex items-center gap-1.5">
              <BookOpen className="size-3.5 shrink-0" />
              <span>{session.course.title}</span>
            </div>
          )}
        </div>

        {/* Tutor */}
        <div className="flex items-center gap-2 text-sm">
          <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {session.tutor.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="font-medium">{session.tutor.name}</span>
        </div>

        {/* CTA */}
        <Button asChild className="w-full" size="sm" variant={live ? "default" : "outline"}>
          <Link href={`/student/classroom/${session.id}`}>
            {live ? (
              <><Radio className="size-4 mr-1.5" /> Join Now</>
            ) : (
              <><ChevronRight className="size-4 mr-1" /> View Details</>
            )}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
