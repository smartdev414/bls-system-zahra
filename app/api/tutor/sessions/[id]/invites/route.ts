import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotifications } from "@/lib/notifications"

export async function POST(
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
    const { studentId } = await req.json() as { studentId: string }
    if (!studentId) return NextResponse.json({ message: "studentId is required" }, { status: 400 })

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.status !== "SCHEDULED") {
      return NextResponse.json({ message: "Can only invite to scheduled sessions" }, { status: 400 })
    }

    // Upsert invite (idempotent)
    await prisma.liveSessionInvite.upsert({
      where: { sessionId_studentId: { sessionId: id, studentId } },
      create: { sessionId: id, studentId },
      update: {},
    })

    const scheduledDate = liveSession.scheduledAt.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })

    void createNotifications(
      [studentId],
      "SESSION_INVITE",
      "You've been invited to a live session",
      `${session.name} invited you to "${liveSession.title}" on ${scheduledDate}`,
      `/student/classroom`,
    )

    return NextResponse.json({ message: "Invite sent" }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
