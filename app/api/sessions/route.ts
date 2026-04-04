import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const sessions = await prisma.liveSession.findMany({
      where: {
        OR: [
          { status: { in: ["SCHEDULED", "LIVE"] } },
          { status: "COMPLETED" },
        ],
        AND: {
          OR: [
            { visibility: "PUBLIC" },
            { visibility: "INVITE_ONLY", invites: { some: { studentId: session.sub } } },
          ],
        },
      },
      orderBy: { scheduledAt: "desc" },
      include: {
        tutor: { select: { id: true, name: true, avatarUrl: true } },
        course: { select: { id: true, title: true } },
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
        tutor: s.tutor,
        course: s.course,
        attendeeCount: s._count.attendances,
        recordingUrl: s.recordingUrl ?? null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
