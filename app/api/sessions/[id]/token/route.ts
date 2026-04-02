import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { AccessToken } from "livekit-server-sdk"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const liveSession = await prisma.liveSession.findUnique({
      where: { id },
    })

    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.status === "CANCELLED" || liveSession.status === "COMPLETED") {
      return NextResponse.json({ message: "Session is no longer active" }, { status: 410 })
    }

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const wsUrl = process.env.LIVEKIT_WS_URL

    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json(
        { message: "LiveKit is not configured. Add LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_WS_URL to your .env" },
        { status: 503 }
      )
    }

    const isTutor = session.role === "TUTOR" && session.sub === liveSession.tutorId

    const at = new AccessToken(apiKey, apiSecret, {
      identity: session.sub,
      name: session.name,
      ttl: 60 * 60, // 1 hour
    })

    at.addGrant({
      roomJoin: true,
      room: liveSession.roomName,
      canPublish: isTutor,
      canSubscribe: true,
      canPublishData: true,
    })

    const token = await at.toJwt()

    // Record attendance for students
    if (session.role === "STUDENT") {
      await prisma.liveSessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId: id, studentId: session.sub } },
        create: { sessionId: id, studentId: session.sub, joinedAt: new Date() },
        update: { joinedAt: new Date() },
      })
    }

    return NextResponse.json({ token, wsUrl, roomName: liveSession.roomName })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/token]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
