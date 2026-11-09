import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostScope } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createNotifications } from "@/lib/notifications"
import { triggerUserEvent } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"

// Manage co-teachers for a live session. Only the owning tutor (or an admin)
// can add/remove co-tutors. Unlike student invites, co-tutors may be added to
// a SCHEDULED *or* LIVE session — the whole point is bringing a second teacher
// in mid-lesson. The token route (app/api/sessions/[id]/token) grants any
// listed co-tutor full tutor permissions when they join.

async function loadOwnedSession(session: { role: string; sub: string }, id: string) {
  // Owner-only: scope by tutorId so co-tutors can't invite further co-tutors.
  // Staff manage the timetable, so they aren't scoped to a single tutor.
  return prisma.liveSession.findFirst({ where: { id, ...hostScope(session) } })
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as { tutorId?: string; tutorIds?: string[] }
    const requested = body.tutorIds ?? (body.tutorId ? [body.tutorId] : [])
    if (requested.length === 0) {
      return NextResponse.json({ message: "tutorId or tutorIds is required" }, { status: 400 })
    }

    const liveSession = await loadOwnedSession(session, id)
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.status === "COMPLETED" || liveSession.status === "CANCELLED") {
      return NextResponse.json({ message: "Session is no longer active" }, { status: 400 })
    }

    // Only invite real tutors, never the owner, and de-dupe.
    const candidateIds = [...new Set(requested)].filter((tid) => tid !== liveSession.tutorId)
    const tutors = await prisma.user.findMany({
      where: { id: { in: candidateIds }, role: "TUTOR" },
      select: { id: true },
    })
    const tutorIds = tutors.map((t) => t.id)
    if (tutorIds.length === 0) {
      return NextResponse.json({ message: "No valid tutors to invite" }, { status: 400 })
    }

    await prisma.liveSessionCoTutor.createMany({
      data: tutorIds.map((tutorId) => ({ sessionId: id, tutorId, invitedById: session.sub })),
      skipDuplicates: true,
    })

    // Awaited, unlike most notification sends: this one *is* the invitation. If
    // it does not land there is nothing else telling the other teacher they are
    // expected, so the host has to be told rather than shown a success message
    // for something that did not happen.
    const notified = await createNotifications(
      tutorIds,
      "SESSION_COTUTOR_INVITE",
      "You've been added as a co-teacher",
      `${session.name} invited you to co-teach "${liveSession.title}". Open the classroom to join.`,
      `/tutor/classroom/${id}`,
    )

    // Instant pull-in: ping each invitee's personal channel so an online tutor
    // gets a toast with a "Join now" link straight away, rather than waiting to
    // spot the notification. `live` lets the client emphasise an in-progress room.
    const isLive = liveSession.status === "LIVE"
    void Promise.all(
      tutorIds.map((tutorId) =>
        triggerUserEvent(tutorId, "cotutor-invite", {
          sessionId: id,
          sessionTitle: liveSession.title,
          from: session.name,
          live: isLive,
        }).catch(() => { /* realtime is best-effort; notification is the fallback */ }),
      ),
    )

    return NextResponse.json(
      { message: "Co-teacher(s) added", count: tutorIds.length, notified },
      { status: 201 },
    )
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/co-tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const liveSession = await loadOwnedSession(session, id)
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const coTutors = await prisma.liveSessionCoTutor.findMany({
      where: { sessionId: id },
      include: { tutor: { select: { id: true, name: true, email: true } } },
      orderBy: { invitedAt: "desc" },
    })

    return NextResponse.json({
      coTutors: coTutors.map((c) => ({
        tutorId: c.tutorId,
        tutorName: c.tutor.name,
        tutorEmail: c.tutor.email,
        invitedAt: c.invitedAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/co-tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { tutorId } = await req.json() as { tutorId: string }
    if (!tutorId) return NextResponse.json({ message: "tutorId is required" }, { status: 400 })

    const liveSession = await loadOwnedSession(session, id)
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    await prisma.liveSessionCoTutor.deleteMany({ where: { sessionId: id, tutorId } })

    return NextResponse.json({ message: "Co-teacher removed" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]/co-tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
