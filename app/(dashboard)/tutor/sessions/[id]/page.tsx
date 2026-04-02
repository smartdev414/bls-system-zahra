"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronLeft, Radio, CheckCircle2, XCircle, Clock,
  Users, Calendar, Loader2, BookOpen, Trash2, Video, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useFetch, usePatchCallback, useDeleteCallback, usePostCallback } from "@/hooks/use-fetch"
import {
  LiveKitRoom,
  VideoConference,
} from "@livekit/components-react"
import "@livekit/components-styles"

// ─── Types ────────────────────────────────────────────────────────────────────

type Attendance = {
  studentId: string
  studentName: string
  studentEmail: string
  joinedAt: string | null
  leftAt: string | null
}

type SessionDetail = {
  id: string
  title: string
  description: string | null
  scheduledAt: string
  durationMins: number
  roomName: string
  maxStudents: number | null
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
  startedAt: string | null
  endedAt: string | null
  course: { id: string; title: string } | null
  attendances: Attendance[]
}

type SessionData = { session: SessionDetail }
type TokenData = { token: string; wsUrl: string; roomName: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusConfig = {
  SCHEDULED: { label: "Scheduled", className: "bg-amber-100 text-amber-700 border-amber-200" },
  LIVE:      { label: "Live",      className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  COMPLETED: { label: "Completed", className: "bg-muted text-muted-foreground" },
  CANCELLED: { label: "Cancelled", className: "bg-rose-100 text-rose-700 border-rose-200" },
}

function formatDuration(startIso: string, endIso: string) {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [roomData, setRoomData] = useState<TokenData | null>(null)

  const { data, loading, refetch } = useFetch<SessionData>(`/api/tutor/sessions/${id}`, {
    errorMessage: "Could not load session",
  })

  const { execute: patch, loading: patching } = usePatchCallback<
    { session: SessionDetail },
    { status: "LIVE" | "COMPLETED" | "CANCELLED" }
  >(`/api/tutor/sessions/${id}`, {
    successMessage: (d) => `Session ${(d as { session: { status: string } }).session.status.toLowerCase()}`,
    errorMessage: "Could not update session",
    onSuccess: () => refetch(),
  })

  const { execute: getToken, loading: joiningRoom, error: tokenError } = usePostCallback<TokenData, Record<string, never>>(
    `/api/sessions/${id}/token`,
    {
      successMessage: false,
      errorMessage: false,
      onSuccess: (data) => setRoomData(data),
    }
  )

  const { execute: deleteSession, loading: deleting } = useDeleteCallback(
    `/api/tutor/sessions/${id}`,
    {
      successMessage: "Session deleted",
      errorMessage: "Could not delete session",
      onSuccess: () => router.push("/tutor/sessions"),
    }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) return null

  const { session } = data
  const cfg = statusConfig[session.status]
  const scheduled = new Date(session.scheduledAt)
  const canStart = session.status === "SCHEDULED"
  const isLive = session.status === "LIVE"
  const isDone = session.status === "COMPLETED" || session.status === "CANCELLED"

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href="/tutor/sessions">
          <ChevronLeft className="size-4 mr-1" /> Sessions
        </Link>
      </Button>

      {/* Header card */}
      <Card className={`shadow-sm overflow-hidden ${isLive ? "border-emerald-300 ring-1 ring-emerald-200" : ""}`}>
        {isLive && (
          <div className="bg-emerald-500 text-white px-5 py-2 flex items-center gap-2">
            <Radio className="size-3.5 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wide">Session in progress</span>
          </div>
        )}
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Badge variant="outline" className={`mb-3 ${cfg.className}`}>{cfg.label}</Badge>
              <h1 className="text-2xl font-black">{session.title}</h1>
              {session.description && (
                <p className="text-muted-foreground mt-2">{session.description}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 shrink-0">
              {canStart && (
                <Button
                  onClick={() => {
                    patch({ status: "LIVE" })
                    getToken({})
                  }}
                  disabled={patching || joiningRoom}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Radio className="size-4 mr-1.5" /> Start &amp; Join
                </Button>
              )}
              {isLive && !roomData && (
                <Button
                  onClick={() => getToken({})}
                  disabled={joiningRoom}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {joiningRoom
                    ? <><Loader2 className="size-4 animate-spin mr-1.5" /> Connecting…</>
                    : <><Video className="size-4 mr-1.5" /> Join Room</>}
                </Button>
              )}
              {isLive && roomData && (
                <Button variant="outline" onClick={() => setRoomData(null)}>
                  Leave Room
                </Button>
              )}
              {isLive && (
                <Button variant="outline" onClick={() => patch({ status: "COMPLETED" })} disabled={patching}>
                  <CheckCircle2 className="size-4 mr-1.5" /> End Session
                </Button>
              )}
              {!isDone && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => patch({ status: "CANCELLED" })}
                  disabled={patching}
                >
                  <XCircle className="size-4 mr-1.5" /> Cancel
                </Button>
              )}
            </div>
          </div>

          <Separator className="my-5" />

          {/* Meta grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Date</p>
              <p className="font-medium flex items-center gap-1.5">
                <Calendar className="size-3.5 text-primary" />
                {scheduled.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Time</p>
              <p className="font-medium flex items-center gap-1.5">
                <Clock className="size-3.5 text-primary" />
                {scheduled.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Duration</p>
              <p className="font-medium flex items-center gap-1.5">
                <Clock className="size-3.5 text-primary" />
                {session.startedAt && session.endedAt
                  ? formatDuration(session.startedAt, session.endedAt)
                  : `${session.durationMins} min`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Attendees</p>
              <p className="font-medium flex items-center gap-1.5">
                <Users className="size-3.5 text-primary" />
                {session.attendances.length}
                {session.maxStudents ? ` / ${session.maxStudents}` : ""}
              </p>
            </div>
          </div>

          {session.course && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2 text-sm">
                <BookOpen className="size-4 text-primary shrink-0" />
                <span className="text-muted-foreground">Linked course:</span>
                <Link href={`/tutor/courses/${session.course.id}`} className="font-medium text-primary hover:underline">
                  {session.course.title}
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* LiveKit room (shown when joined) */}
      {tokenError && (
        <Card className="shadow-sm border-destructive/30">
          <CardContent className="p-4 flex items-center gap-3 text-destructive text-sm">
            <AlertCircle className="size-4 shrink-0" />
            {tokenError.message}
          </CardContent>
        </Card>
      )}
      {roomData && (
        <Card className="shadow-sm overflow-hidden border-emerald-300 ring-1 ring-emerald-200">
          <div className="bg-emerald-500 text-white px-5 py-2 flex items-center gap-2">
            <Radio className="size-3.5 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wide">You are live</span>
          </div>
          <div className="h-[60vh]">
            <LiveKitRoom
              token={roomData.token}
              serverUrl={roomData.wsUrl}
              connect={true}
              video={true}
              audio={true}
              onDisconnected={() => setRoomData(null)}
              className="h-full"
            >
              <VideoConference />
            </LiveKitRoom>
          </div>
        </Card>
      )}

      {/* Attendees */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Attendees
            {session.attendances.length > 0 && (
              <Badge variant="secondary" className="ml-1">{session.attendances.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {session.attendances.length > 0 ? (
            <div className="divide-y">
              {session.attendances.map((a) => {
                const initials = a.studentName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                return (
                  <div key={a.studentId} className="flex items-center gap-4 px-5 py-3">
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{a.studentName}</p>
                      <p className="text-xs text-muted-foreground">{a.studentEmail}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      {a.joinedAt && (
                        <p>Joined {new Date(a.joinedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                      )}
                      {a.leftAt && (
                        <p>Left {new Date(a.leftAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No attendees yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      {!isDone && (
        <Card className="shadow-sm border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this session</p>
              <p className="text-xs text-muted-foreground mt-0.5">This cannot be undone.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => deleteSession()}
            >
              <Trash2 className="size-4 mr-1.5" />
              {deleting ? "Deleting..." : "Delete Session"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
