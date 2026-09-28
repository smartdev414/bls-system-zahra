import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { startRecordingSegment } from "@/lib/recording"

// Resume = start a new egress writing to a fresh segment filename. Segments
// share the prefix `recordings/{sessionId}` so they can be discovered later
// and stitched together. First segment uses the base name (matches existing
// behaviour from /recording/start); subsequent segments get a numeric suffix.
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
      where: { id, tutorId: session.sub },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    if (liveSession.egressId) {
      // Already recording — idempotent return.
      return NextResponse.json({ resumed: true, alreadyRecording: true, egressId: liveSession.egressId })
    }

    const info = await startRecordingSegment(id, liveSession.roomName)
    console.log("[egress] resumed with new segment:", info.filepath, "session:", id)

    return NextResponse.json({ resumed: true, egressId: info.egressId, segment: info.segment })
  } catch (err) {
    console.error("[egress] resume failed", err)
    return NextResponse.json({ message: "Failed to resume recording" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
