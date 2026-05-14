import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { EgressClient, EncodedFileOutput, S3Upload } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"
import { listObjectKeys } from "@/lib/s3"
import { egressTemplateUrl } from "@/lib/publicUrl"

function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

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

    // Determine the next segment number by listing what's already in S3 for
    // this session. Pattern: `recordings/{id}.mp4`, `recordings/{id}-2.mp4`, …
    const existing = await listObjectKeys(`recordings/${id}`)
    const segmentNumber = existing.length + 1
    const filepath = segmentNumber === 1
      ? `recordings/${id}.mp4`
      : `recordings/${id}-${segmentNumber}.mp4`

    console.log("[egress] resuming with new segment:", filepath, "session:", id)

    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      bucket: process.env.AWS_S3_BUCKET!,
      region: process.env.AWS_REGION ?? "eu-west-2",
    })
    const fileOutput = new EncodedFileOutput({
      filepath,
      output: { case: "s3", value: s3Upload },
    })

    // Same custom template as `/recording/start` so the resumed segment
    // carries the Deaf Signs logo watermark too.
    const info = await egressClient().startRoomCompositeEgress(
      liveSession.roomName,
      { file: fileOutput },
      { customBaseUrl: egressTemplateUrl() },
    )

    await prisma.liveSession.update({
      where: { id },
      data: {
        egressId: info.egressId,
        recordingKey: filepath,
      },
    })

    return NextResponse.json({ resumed: true, egressId: info.egressId, segment: segmentNumber })
  } catch (err) {
    console.error("[egress] resume failed", err)
    return NextResponse.json({ message: "Failed to resume recording" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
