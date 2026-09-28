import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { reconcilePendingRecordings } from "@/lib/recording"

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

    // Link recordings that reached S3 but were never attached to their session
    // (missed webhook, slow upload) — students would otherwise never see them.
    await reconcilePendingRecordings(sessions)
    const linked = await prisma.liveSession.findMany({
      where: { id: { in: sessions.filter((s) => s.status === "COMPLETED").map((s) => s.id) } },
      select: { id: true, recordingUrl: true },
    })
    const recordingById = new Map(linked.map((r) => [r.id, r.recordingUrl]))

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
        recordingUrl: recordingById.get(s.id) ?? s.recordingUrl ?? null,
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
