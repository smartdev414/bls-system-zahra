import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    // Show ALL sessions (public + invite-only) to students
    const sessions = await prisma.liveSession.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE", "COMPLETED"] },
      },
      orderBy: { scheduledAt: "desc" },
      include: {
        tutor: { select: { id: true, name: true, avatarUrl: true } },
        course: { select: { id: true, title: true } },
        invites: { where: { studentId: session.sub }, select: { id: true } },
        joinRequests: {
          where: { studentId: session.sub },
          select: { id: true, status: true },
        },
        _count: { select: { attendances: true } },
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
        tutor: s.tutor,
        course: s.course,
        attendeeCount: s._count.attendances,
        recordingUrl: s.recordingUrl ?? null,
        isInvited: s.invites.length > 0,
        joinRequest: s.joinRequests[0] ?? null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
