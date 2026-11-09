import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { startRecordingSegment } from "@/lib/recording"

async function handlePOST(
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
      where: { id, ...hostedBy(session.sub) },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    // Already recording
    if (liveSession.egressId) {
      return NextResponse.json({ message: "Already recording", egressId: liveSession.egressId })
    }

    console.log("[egress] starting egress for room:", liveSession.roomName, "session:", id)

    const info = await startRecordingSegment(id, liveSession.roomName)
    console.log("[egress] started successfully, egressId:", info.egressId, "file:", info.filepath)

    return NextResponse.json({ egressId: info.egressId })
  } catch (err) {
    console.error("[egress] startEgress failed", err)
    return NextResponse.json({ message: "Failed to start recording" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
