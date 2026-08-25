import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, ownerScope } from "@/lib/permissions"
import { EgressClient } from "livekit-server-sdk"
import { createNotifications } from "@/lib/notifications"
import { triggerUserEvent } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"
import { reconcileSessionRecording, scheduleRecordingReconcile } from "@/lib/recording"
import { closeLiveKitRoom, notifySessionStatusChange } from "@/lib/live-session-status"

function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

async function stopEgress(egressId: string): Promise<void> {
  try {
    await egressClient().stopEgress(egressId)
  } catch (e) {
    console.error("[egress] stopEgress failed", e)
  }
}

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...ownerScope(session) },
      include: {
        course: { select: { id: true, title: true } },
        attendances: {
          include: {
            student: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
    })

    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    return NextResponse.json({
      session: {
        id: liveSession.id,
        title: liveSession.title,
        description: liveSession.description,
        scheduledAt: liveSession.scheduledAt.toISOString(),
        durationMins: liveSession.durationMins,
        roomName: liveSession.roomName,
        maxStudents: liveSession.maxStudents,
        status: liveSession.status,
        startedAt: liveSession.startedAt?.toISOString() ?? null,
        endedAt: liveSession.endedAt?.toISOString() ?? null,
        course: liveSession.course,
        attendances: liveSession.attendances.map((a) => ({
          studentId: a.studentId,
          studentName: a.student.name,
          studentEmail: a.student.email,
          joinedAt: a.joinedAt?.toISOString() ?? null,
          leftAt: a.leftAt?.toISOString() ?? null,
        })),
      },
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.edit")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.liveSession.findFirst({ where: { id, ...ownerScope(session) } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = await req.json() as {
      status?: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
      title?: string
      description?: string
      scheduledAt?: string
      durationMins?: number
      maxStudents?: number | null
      visibility?: "PUBLIC" | "INVITE_ONLY"
      invitedStudentIds?: string[]
      invitedTutorIds?: string[]
    }

    const data: Record<string, unknown> = {}
    if (body.title) data.title = body.title.trim()
    if (body.description !== undefined) data.description = body.description?.trim() ?? null
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt)
    if (body.durationMins) data.durationMins = body.durationMins
    if (body.maxStudents !== undefined) data.maxStudents = body.maxStudents
    if (body.visibility) data.visibility = body.visibility
    if (body.status) {
      data.status = body.status
      console.log("[session] status transition:", existing.status, "→", body.status, "startedAt:", existing.startedAt, "endedAt:", existing.endedAt)
      if (body.status === "LIVE" && !existing.startedAt) {
        data.startedAt = new Date()
        // Note: egress (recording) is started from /api/sessions/[id]/recording/start
        // after the tutor has joined the room, because the room must exist first
      }
      if (body.status === "COMPLETED" && !existing.endedAt) {
        data.endedAt = new Date()
        console.log("[session] stopping egress, egressId:", existing.egressId)
        if (existing.egressId) {
          const egressId = existing.egressId
          await stopEgress(egressId)
          // Clear immediately — a stale egressId leaves "Recording processing…"
          // spinning forever when background work never runs (e.g. serverless).
          data.egressId = null
          await reconcileSessionRecording(id, { egressId, pollEgress: true })
          scheduleRecordingReconcile(id, egressId)
          console.log("[session] egress stopped; recording reconciled")
        } else {
          console.log("[session] no egressId found, recording not available")
        }
      }
    }

    const updated = await prisma.liveSession.update({ where: { id }, data })

    // Sync invites when invitedStudentIds is provided
    if (body.invitedStudentIds !== undefined && body.visibility === "INVITE_ONLY") {
      await prisma.liveSessionInvite.deleteMany({ where: { sessionId: id } })
      if (body.invitedStudentIds.length > 0) {
        await prisma.liveSessionInvite.createMany({
          data: body.invitedStudentIds.map((studentId) => ({ sessionId: id, studentId })),
          skipDuplicates: true,
        })
      }
    }

    // Sync co-teachers when invitedTutorIds is provided
    if (body.invitedTutorIds !== undefined) {
      const candidateIds = [...new Set(body.invitedTutorIds)].filter((tid) => tid !== session.sub)
      const tutors = await prisma.user.findMany({
        where: { id: { in: candidateIds }, role: "TUTOR" },
        select: { id: true },
      })
      const newTutorIds = new Set(tutors.map((t) => t.id))

      const existingCoTutors = await prisma.liveSessionCoTutor.findMany({
        where: { sessionId: id },
        select: { tutorId: true },
      })
      const existingIds = new Set(existingCoTutors.map((c) => c.tutorId))

      const toRemove = [...existingIds].filter((tid) => !newTutorIds.has(tid))
      const toAdd = [...newTutorIds].filter((tid) => !existingIds.has(tid))

      if (toRemove.length > 0) {
        await prisma.liveSessionCoTutor.deleteMany({
          where: { sessionId: id, tutorId: { in: toRemove } },
        })
      }

      if (toAdd.length > 0) {
        await prisma.liveSessionCoTutor.createMany({
          data: toAdd.map((tutorId) => ({
            sessionId: id,
            tutorId,
            invitedById: session.sub,
          })),
          skipDuplicates: true,
        })

        void createNotifications(
          toAdd,
          "SESSION_COTUTOR_INVITE",
          "You've been added as a co-teacher",
          `${session.name} invited you to co-teach "${updated.title}". Open the classroom to join.`,
          `/tutor/classroom/${id}`,
        )

        const isLive = updated.status === "LIVE"
        void Promise.all(
          toAdd.map((tutorId) =>
            triggerUserEvent(tutorId, "cotutor-invite", {
              sessionId: id,
              sessionTitle: updated.title,
              from: session.name,
              live: isLive,
            }).catch(() => {}),
          ),
        )
      }
    }

    // When the host ends (or cancels) a session, close the LiveKit room and tell
    // co-teachers immediately — they otherwise keep seeing "Live Now" until refresh.
    if (body.status === "COMPLETED" || body.status === "CANCELLED") {
      void closeLiveKitRoom(existing.roomName)
      void notifySessionStatusChange(id, body.status, updated.title, existing.tutorId)
      // Drop the stage snapshot with it. It's what late joiners hydrate from, so
      // leaving it behind would put last lesson's deck in front of anyone who
      // opens the room again (a session can be set back to LIVE).
      void prisma.liveSessionPresentation
        .deleteMany({ where: { sessionId: id } })
        .catch(() => { /* best effort — a stale row is corrected on the next start */ })
    }

    // Notify students on critical status transitions
    if (body.status === "LIVE" || body.status === "CANCELLED") {
      // Gather the relevant audience: invited students (INVITE_ONLY) or enrolled students (PUBLIC)
      const audienceIds = existing.visibility === "INVITE_ONLY"
        ? (await prisma.liveSessionInvite.findMany({
            where: { sessionId: id },
            select: { studentId: true },
          })).map((i) => i.studentId)
        : existing.courseId
          ? (await prisma.enrollment.findMany({
              where: { courseId: existing.courseId },
              select: { studentId: true },
            })).map((e) => e.studentId)
          : []

      if (audienceIds.length > 0) {
        if (body.status === "LIVE") {
          void createNotifications(
            audienceIds,
            "SESSION_STARTED",
            "Live session has started!",
            `"${existing.title}" is now live — join now`,
            `/student/classroom`,
          )
        } else if (body.status === "CANCELLED") {
          void createNotifications(
            audienceIds,
            "SESSION_CANCELLED",
            "Live session cancelled",
            `"${existing.title}" has been cancelled`,
            `/student/classroom`,
          )
        }
      }
    }

    return NextResponse.json({ session: updated })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.delete")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.liveSession.findFirst({ where: { id, ...ownerScope(session) } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    // Notify audience before deleting
    const audienceIds = existing.visibility === "INVITE_ONLY"
      ? (await prisma.liveSessionInvite.findMany({
          where: { sessionId: id },
          select: { studentId: true },
        })).map((i) => i.studentId)
      : existing.courseId
        ? (await prisma.enrollment.findMany({
            where: { courseId: existing.courseId },
            select: { studentId: true },
          })).map((e) => e.studentId)
        : []

    if (audienceIds.length > 0) {
      void createNotifications(
        audienceIds,
        "SESSION_DELETED",
        "Live session removed",
        `"${existing.title}" has been removed by the tutor`,
        `/student/classroom`,
      )
    }

    await prisma.liveSession.delete({ where: { id } })
    return NextResponse.json({ message: "Session deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
