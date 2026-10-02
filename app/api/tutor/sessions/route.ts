import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope, isStaff } from "@/lib/permissions"
import { randomBytes } from "crypto"
import { createNotifications } from "@/lib/notifications"
import { triggerUserEvent } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"
import { reconcilePendingRecordings } from "@/lib/recording"
import { usableGroups } from "@/lib/course-groups"

/**
 * Resolves the tutor a live session belongs to.
 *
 * A tutor owns what they create. Staff (admin, support) can't teach, so they
 * pass the tutor explicitly — a support user with no `tutorId` is a 400 rather
 * than a class silently owned by an office account.
 */
async function resolveSessionOwner(
  session: { role: string; sub: string },
  tutorId: string | undefined,
): Promise<string | NextResponse> {
  if (!isStaff(session.role)) return session.sub
  if (!tutorId) {
    return NextResponse.json(
      { message: "Choose the tutor who will take this class" },
      { status: 400 },
    )
  }
  const tutor = await prisma.user.findFirst({
    where: { id: tutorId, role: "TUTOR" },
    select: { id: true },
  })
  if (!tutor) return NextResponse.json({ message: "Tutor not found" }, { status: 400 })
  return tutor.id
}

// GET /api/tutor/sessions[?courseId=…] — optionally just one course's classes
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const courseId = req.nextUrl.searchParams.get("courseId")?.trim()
    const courseFilter = courseId ? { courseId } : {}

    // Sessions this tutor owns, plus sessions they were invited to co-teach.
    // Staff (admin, support) build the whole timetable, so they see every one.
    const sessionInclude = {
      course: { select: { id: true, title: true } },
      group: { select: { id: true, name: true } },
      tutor: { select: { id: true, name: true } },
      _count: { select: { attendances: true, invites: true } },
    } as const

    const staff = isStaff(session.role)

    const [owned, coTutorLinks] = await Promise.all([
      prisma.liveSession.findMany({
        where: { ...(staff ? {} : { tutorId: session.sub }), ...courseFilter },
        orderBy: { scheduledAt: "desc" },
        include: sessionInclude,
      }),
      prisma.liveSessionCoTutor.findMany({
        where: { tutorId: session.sub, session: courseFilter },
        include: { session: { include: sessionInclude } },
      }),
    ])

    const coSessions = coTutorLinks.map((c) => c.session)
    await reconcilePendingRecordings([
      ...owned,
      ...coSessions.filter((s) => !owned.some((o) => o.id === s.id)),
    ])

    // Re-read recording fields that reconcile may have updated.
    const refreshed = await prisma.liveSession.findMany({
      where: { id: { in: [...owned, ...coSessions].map((s) => s.id) } },
      select: { id: true, recordingUrl: true, egressId: true, recordingKey: true },
    })
    const recordingById = new Map(refreshed.map((r) => [r.id, r]))
    for (const s of owned) {
      const r = recordingById.get(s.id)
      if (r) {
        s.recordingUrl = r.recordingUrl
        s.egressId = r.egressId
        s.recordingKey = r.recordingKey
      }
    }
    for (const s of coSessions) {
      const r = recordingById.get(s.id)
      if (r) {
        s.recordingUrl = r.recordingUrl
        s.egressId = r.egressId
        s.recordingKey = r.recordingKey
      }
    }

    type SessionWithCounts = (typeof owned)[number]
    const shape = (s: SessionWithCounts, isCoTutor: boolean) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      scheduledAt: s.scheduledAt.toISOString(),
      durationMins: s.durationMins,
      roomName: s.roomName,
      maxStudents: s.maxStudents,
      status: s.status,
      visibility: s.visibility,
      course: s.course,
      // Set when the class is for one group on the course.
      group: s.group,
      attendeeCount: s._count.attendances,
      inviteCount: s._count.invites,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      recordingUrl: s.recordingUrl ?? null,
      recordingKey: s.recordingKey ?? null,
      egressId: s.egressId ?? null,
      isCoTutor,
      // Only staff schedule on someone else's behalf, so only they need to
      // know (and re-assign) who owns the class.
      ...(staff ? { tutorId: s.tutorId, tutorName: s.tutor?.name ?? null } : {}),
    })

    // De-dupe defensively (the co-tutor route never lets the owner self-invite).
    const ownedIds = new Set(owned.map((s) => s.id))
    const merged = [
      ...owned.map((s) => shape(s, false)),
      ...coTutorLinks
        .filter((c) => !ownedIds.has(c.sessionId))
        .map((c) => shape(c.session, true)),
    ].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))

    return NextResponse.json({ sessions: merged })
  } catch (err) {
    console.error("[GET /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.create")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as {
      title: string
      description?: string
      scheduledAt: string
      durationMins: number
      maxStudents?: number
      courseId?: string
      visibility?: "PUBLIC" | "INVITE_ONLY"
      invitedStudentIds?: string[]
      invitedTutorIds?: string[]
      repeatWeeks?: number
      /** Staff only — the tutor who will take the class. */
      tutorId?: string
      /** The class is for this group: its members are invited, nobody else. */
      groupId?: string
    }

    const { title, description, scheduledAt, durationMins, maxStudents, courseId, invitedTutorIds = [], repeatWeeks = 1 } = body

    if (!title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })
    if (!scheduledAt) return NextResponse.json({ message: "scheduledAt is required" }, { status: 400 })
    if (!durationMins || durationMins < 5) {
      return NextResponse.json({ message: "durationMins must be at least 5" }, { status: 400 })
    }

    // Who owns the class. Tutors always own the ones they create; support staff
    // schedule on a tutor's behalf and must name them.
    const ownerId = await resolveSessionOwner(session, body.tutorId)
    if (typeof ownerId !== "string") return ownerId

    // The course link decides which students see the class, so a tutor may only
    // link the courses they teach.
    if (courseId) {
      const course = await prisma.course.findFirst({
        where: { id: courseId, ...courseTeachScope(session) },
        select: { id: true },
      })
      if (!course) return NextResponse.json({ message: "Course not found" }, { status: 400 })
    }

    // A class for one group is invite-only by definition, and its invitees are
    // the group's members — taken from the group, not from what was sent.
    let visibility = body.visibility ?? "PUBLIC"
    let invitedStudentIds = body.invitedStudentIds ?? []
    let groupId: string | null = null
    if (body.groupId) {
      const group = await prisma.studentGroup.findFirst({
        where: { id: body.groupId, ...usableGroups(session) },
        select: { id: true, members: { select: { studentId: true } } },
      })
      if (!group) return NextResponse.json({ message: "Group not found" }, { status: 400 })
      groupId = group.id
      visibility = "INVITE_ONLY"
      invitedStudentIds = group.members.map((m) => m.studentId)
    }

    const occurrences = Math.min(Math.max(Math.floor(repeatWeeks) || 1, 1), 52)
    const baseDate = new Date(scheduledAt)

    const created = await Promise.all(
      Array.from({ length: occurrences }, (_, i) => {
        const occursAt = new Date(baseDate)
        occursAt.setDate(occursAt.getDate() + i * 7)
        return prisma.liveSession.create({
          data: {
            tutorId: ownerId,
            title: title.trim(),
            description: description?.trim() ?? null,
            scheduledAt: occursAt,
            durationMins,
            roomName: `bsl-${randomBytes(6).toString("hex")}`,
            maxStudents: maxStudents ?? null,
            courseId: courseId ?? null,
            groupId,
            status: "SCHEDULED",
            visibility,
            ...(visibility === "INVITE_ONLY" && invitedStudentIds.length > 0 && {
              invites: {
                create: invitedStudentIds.map((studentId) => ({ studentId })),
              },
            }),
          },
        })
      })
    )

    const firstScheduledDate = baseDate.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })
    const seriesSuffix = occurrences > 1 ? ` (weekly series, ${occurrences} sessions)` : ""
    const sessionLink = `/student/classroom`

    // Co-teacher invites (independent of student visibility)
    const coTutorCandidateIds = [...new Set(invitedTutorIds)].filter((tid) => tid !== ownerId)
    if (coTutorCandidateIds.length > 0) {
      const tutors = await prisma.user.findMany({
        where: { id: { in: coTutorCandidateIds }, role: "TUTOR" },
        select: { id: true },
      })
      const tutorIds = tutors.map((t) => t.id)
      if (tutorIds.length > 0) {
        await Promise.all(
          created.map((s) =>
            prisma.liveSessionCoTutor.createMany({
              data: tutorIds.map((tutorId) => ({
                sessionId: s.id,
                tutorId,
                invitedById: session.sub,
              })),
              skipDuplicates: true,
            }),
          ),
        )
        const cotutorLink = occurrences > 1 ? "/tutor/sessions" : `/tutor/classroom/${created[0].id}`
        void createNotifications(
          tutorIds,
          "SESSION_COTUTOR_INVITE",
          occurrences > 1 ? "You've been added as a co-teacher to a weekly series" : "You've been added as a co-teacher",
          `${session.name} invited you to co-teach "${title.trim()}" starting ${firstScheduledDate}${seriesSuffix}`,
          cotutorLink,
        )
        void Promise.all(
          tutorIds.map((tutorId) =>
            triggerUserEvent(tutorId, "cotutor-invite", {
              sessionId: created[0].id,
              sessionTitle: title.trim(),
              from: session.name,
              live: false,
            }).catch(() => {}),
          ),
        )
      }
    }

    if (visibility === "INVITE_ONLY" && invitedStudentIds.length > 0) {
      void createNotifications(
        invitedStudentIds,
        "SESSION_INVITE",
        occurrences > 1 ? "You've been invited to a weekly live session series" : "You've been invited to a live session",
        `${session.name} invited you to "${title.trim()}" starting ${firstScheduledDate}${seriesSuffix}`,
        sessionLink,
      )
    } else if (visibility === "PUBLIC" && courseId) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        select: { studentId: true },
      })
      const studentIds = enrollments.map((e) => e.studentId).filter((id) => id !== session.sub)
      void createNotifications(
        studentIds,
        "SESSION_SCHEDULED",
        occurrences > 1 ? "New weekly live session series scheduled" : "New live session scheduled",
        `${session.name} scheduled "${title.trim()}" starting ${firstScheduledDate}${seriesSuffix}`,
        sessionLink,
      )
    }

    return NextResponse.json({ session: created[0], sessions: created }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
