import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { EgressClient } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"

function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

// Pause = stop the current egress. Each pause/resume cycle produces a separate
// recording segment in S3 because LiveKit Egress doesn't support a true pause.
// The latest segment's key remains in `recordingKey` so the webhook can finalise
// it. Resume starts a new egress with a sequential filename.
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

    if (!liveSession.egressId) {
      // Nothing to pause — treat as a no-op so the UI can stay idempotent.
      return NextResponse.json({ paused: true, alreadyPaused: true })
    }

    console.log("[egress] pausing (stop) egress:", liveSession.egressId, "session:", id)

    try {
      await egressClient().stopEgress(liveSession.egressId)
    } catch (err) {
      // If the egress was already torn down server-side, swallow and clear the
      // stale id so resume can start a fresh one.
      console.warn("[egress] stopEgress on pause failed (continuing):", err)
    }

    await prisma.liveSession.update({
      where: { id },
      data: { egressId: null },
    })

    return NextResponse.json({ paused: true })
  } catch (err) {
    console.error("[egress] pause failed", err)
    return NextResponse.json({ message: "Failed to pause recording" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
