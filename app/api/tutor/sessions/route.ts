import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { randomBytes } from "crypto"

export async function GET() {
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
        course: s.course,
        attendeeCount: s._count.attendances,
        startedAt: s.startedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
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
    }

    const { title, description, scheduledAt, durationMins, maxStudents, courseId } = body

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
      },
    })

    return NextResponse.json({ session: liveSession }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
