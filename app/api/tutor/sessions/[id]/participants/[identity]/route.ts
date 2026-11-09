import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { RoomServiceClient } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"
import { participantBaseId } from "@/lib/livekit"

function roomServiceClient() {
  return new RoomServiceClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, identity } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostedBy(session.sub) },
      select: { id: true, roomName: true },
    })
    if (!liveSession) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 })
    }
    // Identities are `<userId>__<random>`, so compare the base id to block a
    // tutor from removing their own connection.
    if (participantBaseId(identity) === session.sub) {
      return NextResponse.json(
        { message: "You can't remove yourself. Use \"Leave\" to end the session." },
        { status: 400 }
      )
    }

    await roomServiceClient().removeParticipant(liveSession.roomName, identity)
    return NextResponse.json({ message: "Participant removed" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]/participants/[identity]]", err)
    return NextResponse.json({ message: "Could not remove participant" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
