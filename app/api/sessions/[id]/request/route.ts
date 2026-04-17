import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"

// POST — student sends a join request
async function handlePOST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: sessionId } = await params
    const { message } = await req.json() as { message?: string }

    const liveSession = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      select: { id: true, title: true, tutorId: true, status: true, visibility: true },
    })

    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.visibility !== "INVITE_ONLY") {
      return NextResponse.json({ message: "This session is public — no request needed" }, { status: 400 })
    }
    if (liveSession.status !== "SCHEDULED" && liveSession.status !== "LIVE") {
      return NextResponse.json({ message: "This session is no longer accepting join requests" }, { status: 400 })
    }

    // Check if already invited
    const existingInvite = await prisma.liveSessionInvite.findUnique({
      where: { sessionId_studentId: { sessionId, studentId: session.sub } },
    })
    if (existingInvite) {
      return NextResponse.json({ message: "You're already invited to this session" }, { status: 409 })
    }

    // Upsert request (one per student per session)
    const request = await prisma.sessionJoinRequest.upsert({
      where: { sessionId_studentId: { sessionId, studentId: session.sub } },
      create: {
        sessionId,
        studentId: session.sub,
        message: message?.trim() || null,
      },
      update: {
        message: message?.trim() || null,
        status: "PENDING",
        respondedAt: null,
        responseMessage: null,
      },
    })

    // Notify tutor
    void createNotification(
      liveSession.tutorId,
      "SESSION_JOIN_REQUEST",
      "Join request for your session",
      `${session.name} is requesting to join "${liveSession.title}"${message ? `: "${message.trim().slice(0, 100)}"` : ""}`,
      `/tutor/sessions/${sessionId}`,
    )

    return NextResponse.json({ request }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/request]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
