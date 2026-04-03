import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const now = new Date()

    const sessions = await prisma.liveSession.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledAt: { gte: new Date(now.getTime() - 30 * 60 * 1000) }, // include sessions started up to 30 mins ago
      },
      orderBy: { scheduledAt: "asc" },
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
      })),
    })
  } catch (err) {
    console.error("[GET /api/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
