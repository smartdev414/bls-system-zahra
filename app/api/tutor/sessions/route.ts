import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { randomBytes } from "crypto"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const sessions = await prisma.liveSession.findMany({
      where: { tutorId: session.sub },
      orderBy: { scheduledAt: "desc" },
      include: {
        course: { select: { id: true, title: true } },
        _count: { select: { attendances: true, invites: true } },
      },
    })

    return NextResponse.json({
      sessions: sessions.map((s) => ({
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
        attendeeCount: s._count.attendances,
        inviteCount: s._count.invites,
        startedAt: s.startedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
        recordingUrl: s.recordingUrl ?? null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
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
    }

    const { title, description, scheduledAt, durationMins, maxStudents, courseId, visibility = "PUBLIC", invitedStudentIds = [] } = body

    if (!title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })
    if (!scheduledAt) return NextResponse.json({ message: "scheduledAt is required" }, { status: 400 })
    if (!durationMins || durationMins < 5) {
      return NextResponse.json({ message: "durationMins must be at least 5" }, { status: 400 })
    }

    // Generate a unique room name
    const roomName = `bsl-${randomBytes(6).toString("hex")}`

    const liveSession = await prisma.liveSession.create({
      data: {
        tutorId: session.sub,
        title: title.trim(),
        description: description?.trim() ?? null,
        scheduledAt: new Date(scheduledAt),
        durationMins,
        roomName,
        maxStudents: maxStudents ?? null,
        courseId: courseId ?? null,
        status: "SCHEDULED",
        visibility,
        ...(visibility === "INVITE_ONLY" && invitedStudentIds.length > 0 && {
          invites: {
            create: invitedStudentIds.map((studentId) => ({ studentId })),
          },
        }),
      },
    })

    const scheduledDate = new Date(scheduledAt).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })
    const sessionLink = `/student/classroom`

    if (visibility === "INVITE_ONLY" && invitedStudentIds.length > 0) {
      // Notify only invited students
      void createNotifications(
        invitedStudentIds,
        "SESSION_INVITE",
        "You've been invited to a live session",
        `${session.name} invited you to "${title.trim()}" on ${scheduledDate}`,
        sessionLink,
      )
    } else if (visibility === "PUBLIC" && courseId) {
      // Notify all students enrolled in the linked course
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        select: { studentId: true },
      })
      const studentIds = enrollments.map((e) => e.studentId).filter((id) => id !== session.sub)
      void createNotifications(
        studentIds,
        "SESSION_SCHEDULED",
        "New live session scheduled",
        `${session.name} scheduled "${title.trim()}" on ${scheduledDate}`,
        sessionLink,
      )
    }

    return NextResponse.json({ session: liveSession }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
