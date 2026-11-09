import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"

// GET — list pending join requests for a session
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    // Verify tutor owns the session
    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostedBy(session.sub) },
      select: { id: true },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const requests = await prisma.sessionJoinRequest.findMany({
      where: { sessionId: id },
      include: {
        student: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        student: r.student,
        message: r.message,
        status: r.status,
        responseMessage: r.responseMessage,
        createdAt: r.createdAt.toISOString(),
        respondedAt: r.respondedAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PATCH — approve or reject a join request
async function handlePATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: sessionId } = await params
    const { requestId, action, message } = await req.json() as {
      requestId: string
      action: "approve" | "reject"
      message?: string
    }

    if (!requestId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ message: "requestId and action (approve/reject) are required" }, { status: 400 })
    }

    // Verify tutor owns the session
    const liveSession = await prisma.liveSession.findFirst({
      where: { id: sessionId, ...hostedBy(session.sub) },
      select: { id: true, title: true },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const request = await prisma.sessionJoinRequest.findUnique({
      where: { id: requestId, sessionId },
      select: { id: true, studentId: true, status: true },
    })
    if (!request) return NextResponse.json({ message: "Request not found" }, { status: 404 })
    if (request.status !== "PENDING") {
      return NextResponse.json({ message: "Request has already been handled" }, { status: 409 })
    }

    const newStatus = action === "approve" ? "APPROVED" : "REJECTED"

    // Update request
    await prisma.sessionJoinRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus as "APPROVED" | "REJECTED",
        responseMessage: message?.trim() || null,
        respondedAt: new Date(),
      },
    })

    // If approved, auto-create an invite so the student can join
    if (action === "approve") {
      await prisma.liveSessionInvite.create({
        data: { sessionId, studentId: request.studentId },
      }).catch(() => {
        // Ignore if already invited (unique constraint)
      })
    }

    // Notify student
    const notifType = action === "approve" ? "SESSION_REQUEST_APPROVED" : "SESSION_REQUEST_REJECTED"
    const notifTitle = action === "approve"
      ? "Your join request was approved!"
      : "Your join request was declined"
    const notifBody = action === "approve"
      ? `${session.name} approved your request to join "${liveSession.title}"${message ? `. Message: "${message.trim().slice(0, 100)}"` : ""}`
      : `${session.name} declined your request to join "${liveSession.title}"${message ? `. Reason: "${message.trim().slice(0, 100)}"` : ""}`

    void createNotification(
      request.studentId,
      notifType,
      notifTitle,
      notifBody,
      action === "approve" ? `/student/classroom/${sessionId}` : "/student/classroom",
    )

    return NextResponse.json({ message: `Request ${action}d` })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]/requests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
