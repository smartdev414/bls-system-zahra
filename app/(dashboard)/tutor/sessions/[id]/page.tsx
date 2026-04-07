"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronLeft, Radio, CheckCircle2, XCircle, Clock,
  Users, Calendar, Loader2, BookOpen, Trash2, MonitorPlay, UserPlus, X,
  MessageSquare, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { useFetch, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { InviteStudentsModal } from "@/components/classroom/InviteStudentsModal"
import { toast } from "sonner"

type Invite = {
  studentId: string
  studentName: string
  studentEmail: string
  invitedAt: string
}

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

type JoinRequest = {
  id: string
  student: { id: string; name: string; email: string; avatarUrl: string | null }
  message: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  responseMessage: string | null
  createdAt: string
  respondedAt: string | null
}

type SessionData = { session: SessionDetail }

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
  const [showInviteModal, setShowInviteModal] = useState(false)

  const { data, loading, refetch } = useFetch<SessionData>(`/api/tutor/sessions/${id}`, {
    errorMessage: "Could not load session",
  })

  const { data: invitesData, refetch: refetchInvites } = useFetch<{ invites: Invite[] }>(
    `/api/tutor/sessions/${id}/invites`,
    { errorMessage: false }
  )

  const { data: requestsData, refetch: refetchRequests } = useFetch<{ requests: JoinRequest[] }>(
    `/api/tutor/sessions/${id}/requests`,
    { errorMessage: false }
  )

  const pendingRequests = (requestsData?.requests ?? []).filter((r) => r.status === "PENDING")

  async function handleRequest(requestId: string, action: "approve" | "reject", message?: string) {
    const res = await fetch(`/api/tutor/sessions/${id}/requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action, message }),
    })
    if (res.ok) {
      refetchRequests()
      if (action === "approve") refetchInvites()
      toast.success(action === "approve" ? "Request approved" : "Request declined")
    } else {
      toast.error("Could not handle request")
    }
  }

  async function removeInvite(studentId: string) {
    const res = await fetch(`/api/tutor/sessions/${id}/invites`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    })
    if (res.ok) refetchInvites()
    else toast.error("Could not remove invite")
  }

  const { execute: patch, loading: patching } = usePatchCallback<
    { session: SessionDetail },
    { status: "LIVE" | "COMPLETED" | "CANCELLED" }
  >(`/api/tutor/sessions/${id}`, {
    successMessage: (d) => `Session ${(d as { session: { status: string } }).session.status.toLowerCase()}`,
    errorMessage: "Could not update session",
    onSuccess: () => refetch(),
  })

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
      <div className="flex items-center justify-center min-h-100">
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
                  asChild
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Link href={`/tutor/sessions/${session.id}/live`}>
                    <MonitorPlay className="size-4 mr-1.5" /> Open Classroom
                  </Link>
                </Button>
              )}
              {isLive && (
                <Button
                  asChild
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Link href={`/tutor/sessions/${session.id}/live`}>
                    <MonitorPlay className="size-4 mr-1.5" /> Open Classroom
                  </Link>
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

      {/* Invited Students (only for SCHEDULED sessions) */}
      {canStart && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="size-4 text-primary" />
                Invited Students
                {(invitesData?.invites.length ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-1">{invitesData!.invites.length}</Badge>
                )}
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowInviteModal(true)}>
                <UserPlus className="size-3" /> Invite
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!invitesData || invitesData.invites.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No students invited yet.{" "}
                <button className="text-primary underline underline-offset-2" onClick={() => setShowInviteModal(true)}>
                  Invite students
                </button>
              </p>
            ) : (
              <div className="divide-y">
                {invitesData.invites.map((inv) => {
                  const inv_initials = inv.studentName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                  return (
                    <div key={inv.studentId} className="flex items-center gap-3 px-5 py-2.5 group/invite">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {inv_initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{inv.studentName}</p>
                        <p className="text-xs text-muted-foreground">{inv.studentEmail}</p>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                        {new Date(inv.invitedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 opacity-0 group-hover/invite:opacity-100 text-destructive hover:text-destructive"
                        onClick={() => removeInvite(inv.studentId)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Join Requests */}
      {canStart && pendingRequests.length > 0 && (
        <Card className="shadow-sm border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="size-4 text-amber-500" />
              Join Requests
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 ml-1">{pendingRequests.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {pendingRequests.map((req) => (
                <RequestRow key={req.id} request={req} onAction={handleRequest} />
              ))}
            </div>
          </CardContent>
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

      {showInviteModal && (
        <InviteStudentsModal
          sessionId={id}
          sessionTitle={session.title}
          onClose={() => { setShowInviteModal(false); refetchInvites() }}
        />
      )}

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

// ─── Request row with inline approve/reject ──────────────────────────────────

function RequestRow({
  request,
  onAction,
}: {
  request: JoinRequest
  onAction: (id: string, action: "approve" | "reject", message?: string) => void
}) {
  const [replyMsg, setReplyMsg] = useState("")
  const [showReply, setShowReply] = useState(false)
  const initials = request.student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)

  return (
    <div className="px-5 py-3">
      <div className="flex items-start gap-3">
        <Avatar className="size-8 shrink-0 mt-0.5">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold">{request.student.name}</p>
              <p className="text-xs text-muted-foreground">{request.student.email}</p>
            </div>
            <p className="text-[11px] text-muted-foreground shrink-0">
              {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          {request.message && (
            <div className="mt-2 rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground leading-relaxed">
              &ldquo;{request.message}&rdquo;
            </div>
          )}

          {/* Reply input */}
          {showReply && (
            <div className="mt-2">
              <Input
                placeholder="Add a message (optional)..."
                value={replyMsg}
                onChange={(e) => setReplyMsg(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-2">
            {!showReply ? (
              <>
                <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onAction(request.id, "approve")}>
                  <Check className="size-3" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onAction(request.id, "reject")}>
                  <XCircle className="size-3" /> Decline
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setShowReply(true)}>
                  Reply & decide
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onAction(request.id, "approve", replyMsg)}>
                  <Check className="size-3" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onAction(request.id, "reject", replyMsg)}>
                  <XCircle className="size-3" /> Decline
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setShowReply(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
