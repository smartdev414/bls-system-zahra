import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.liveSession.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = await req.json() as {
      status?: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"
      title?: string
      description?: string
      scheduledAt?: string
      durationMins?: number
      maxStudents?: number | null
    }

    const data: Record<string, unknown> = {}
    if (body.title) data.title = body.title.trim()
    if (body.description !== undefined) data.description = body.description?.trim() ?? null
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt)
    if (body.durationMins) data.durationMins = body.durationMins
    if (body.maxStudents !== undefined) data.maxStudents = body.maxStudents
    if (body.status) {
      data.status = body.status
      if (body.status === "LIVE" && !existing.startedAt) data.startedAt = new Date()
      if (body.status === "COMPLETED" && !existing.endedAt) data.endedAt = new Date()
    }

    const updated = await prisma.liveSession.update({ where: { id }, data })
    return NextResponse.json({ session: updated })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.liveSession.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    await prisma.liveSession.delete({ where: { id } })
    return NextResponse.json({ message: "Session deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
