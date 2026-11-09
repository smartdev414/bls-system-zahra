import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostScope } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as { studentId?: string; studentIds?: string[] }

    // Support both single studentId (legacy) and bulk studentIds
    const studentIds = body.studentIds ?? (body.studentId ? [body.studentId] : [])
    if (studentIds.length === 0) {
      return NextResponse.json({ message: "studentId or studentIds is required" }, { status: 400 })
    }

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostScope(session) },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.status !== "SCHEDULED") {
      return NextResponse.json({ message: "Can only invite to scheduled sessions" }, { status: 400 })
    }

    // Upsert all invites (idempotent)
    await prisma.liveSessionInvite.createMany({
      data: studentIds.map((studentId) => ({ sessionId: id, studentId })),
      skipDuplicates: true,
    })

    const scheduledDate = liveSession.scheduledAt.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })

    void createNotifications(
      studentIds,
      "SESSION_INVITE",
      "You've been invited to a live session",
      `${session.name} invited you to "${liveSession.title}" on ${scheduledDate}`,
      `/student/classroom`,
    )

    return NextResponse.json({ message: "Invite(s) sent", count: studentIds.length }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostScope(session) },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const invites = await prisma.liveSessionInvite.findMany({
      where: { sessionId: id },
      include: { student: { select: { id: true, name: true, email: true } } },
      orderBy: { invitedAt: "desc" },
    })

    return NextResponse.json({
      invites: invites.map((inv) => ({
        studentId: inv.studentId,
        studentName: inv.student.name,
        studentEmail: inv.student.email,
        invitedAt: inv.invitedAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentId } = await req.json() as { studentId: string }
    if (!studentId) return NextResponse.json({ message: "studentId is required" }, { status: 400 })

    const liveSession = await prisma.liveSession.findFirst({ where: { id, ...hostScope(session) } })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    await prisma.liveSessionInvite.deleteMany({
      where: { sessionId: id, studentId },
    })

    return NextResponse.json({ message: "Invite removed" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(tutorWrite("calendar", handlePOST))
export const DELETE = withAudit(tutorWrite("calendar", handleDELETE))
