import { NextRequest, NextResponse } from "next/server"
import { MAX_WEEK, parseWeek } from "@/lib/class-week"
import prisma from "@/lib/prisma"
import { hostScope, hostedBy } from "@/lib/session-access"
import { shiftWeeksAfterCancel, shiftWeeksAfterRestore } from "@/lib/class-week-shift"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope, isStaff } from "@/lib/permissions"
import { EgressClient } from "livekit-server-sdk"
import { createNotifications } from "@/lib/notifications"
import { triggerUserEvent } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"
import { requireTutorAccess, tutorWrite } from "@/lib/tutor-access"
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

    // Read-only, so co-teachers may see it too (they get the session in their
    // list and need the attendee register). Writes below stay owner-only.
    const liveSession = await prisma.liveSession.findFirst({
      where: isStaff(session.role)
        ? { id }
        : { id, OR: [hostedBy(session.sub), { coTutors: { some: { tutorId: session.sub } } }] },
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
        week: liveSession.week,
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
    const existing = await prisma.liveSession.findFirst({ where: { id, ...hostScope(session) } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = await req.json() as {
      status?: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
      title?: string
      description?: string
      scheduledAt?: string
      durationMins?: number
      maxStudents?: number | null
      /** null unlinks the session from its course. */
      courseId?: string | null
      visibility?: "PUBLIC" | "INVITE_ONLY"
      invitedStudentIds?: string[]
      invitedTutorIds?: string[]
      /** The course week (1–52), or null to clear it. */
      week?: number | null
      /** With status CANCELLED: why, shown on the course page and sent to students. */
      cancelNote?: string | null
    }

    // Starting and ending a class is teaching, which every tutor does. Anything
    // else changes the timetable, which an admin may have made view only.
    const teachingOnly = (body.status === "LIVE" || body.status === "COMPLETED")
      && Object.keys(body).every((k) => k === "status")
    if (!teachingOnly) {
      const denied = await requireTutorAccess(session, "calendar")
      if (denied) return denied
    }

    const data: Record<string, unknown> = {}
    if (body.courseId !== undefined) {
      // Same rule as scheduling: only a course this person teaches.
      if (body.courseId && body.courseId !== existing.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: body.courseId, ...courseTeachScope(session) },
          select: { id: true, format: true, venue: true },
        })
        if (!course) return NextResponse.json({ message: "Course not found" }, { status: 400 })
        // The class moves to where its new course is taught.
        data.inPerson = course.format === "IN_PERSON"
        data.venue = course.format === "IN_PERSON" ? course.venue : null
      }
      if (!body.courseId) {
        data.inPerson = false
        data.venue = null
      }
      data.courseId = body.courseId || null
    }
    if (body.title) data.title = body.title.trim()
    if (body.description !== undefined) data.description = body.description?.trim() ?? null
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt)
    if (body.durationMins) data.durationMins = body.durationMins
    if (body.week !== undefined) {
      const week = parseWeek(body.week)
      if (week === undefined) return NextResponse.json({ message: `Week must be 1 to ${MAX_WEEK}` }, { status: 400 })
      data.week = week
    }
    if (body.maxStudents !== undefined) data.maxStudents = body.maxStudents
    if (body.visibility) data.visibility = body.visibility
    // A face-to-face class has no online room to go live in.
    if (body.status === "LIVE" && existing.inPerson) {
      return NextResponse.json({ message: "This class is face to face, so it is not started online." }, { status: 409 })
    }
    if (body.status) {
      data.status = body.status
      if (body.status === "CANCELLED") {
        data.cancelNote = typeof body.cancelNote === "string" && body.cancelNote.trim() ? body.cancelNote.trim().slice(0, 500) : null
        data.cancelledAt = new Date()
      } else if (existing.status === "CANCELLED") {
        // Put back on: it is no longer cancelled, so its note goes too.
        data.cancelNote = null
        data.cancelledAt = null
      }
      console.log("[session] status transition:", existing.status, "→", body.status, "startedAt:", existing.startedAt, "endedAt:", existing.endedAt)
      if (body.status === "LIVE" && !existing.startedAt) {
        const now = new Date()
        data.startedAt = now
        // A class started ahead of its slot (e.g. a quick test run) happened
        // now, not on the planned date — otherwise it later shows as a
        // "completed" class sitting in the future.
        if (now < (data.scheduledAt instanceof Date ? data.scheduledAt : existing.scheduledAt)) {
          data.scheduledAt = now
        }
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

    // Keep the course weeks in step: a cancelled class's week goes to the next
    // class, and putting it back on moves the later ones back.
    let renumbered = 0
    if (body.status === "CANCELLED" && existing.status === "SCHEDULED") {
      renumbered = await shiftWeeksAfterCancel([updated])
    } else if (body.status === "SCHEDULED" && existing.status === "CANCELLED") {
      renumbered = await shiftWeeksAfterRestore(updated)
    }

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
            `"${existing.title}" on ${existing.scheduledAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} has been cancelled`
              + (data.cancelNote ? `. Note: ${data.cancelNote as string}` : ""),
            `/student/classroom`,
          )
        }
      }
    }

    return NextResponse.json({ session: updated, renumbered })
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
    const existing = await prisma.liveSession.findFirst({ where: { id, ...hostScope(session) } })
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
export const DELETE = withAudit(tutorWrite("calendar", handleDELETE))
