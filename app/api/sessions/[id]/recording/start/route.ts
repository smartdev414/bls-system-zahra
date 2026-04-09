import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { EgressClient, EncodedFileOutput, S3Upload } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"

function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

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

    // Already recording
    if (liveSession.egressId) {
      return NextResponse.json({ message: "Already recording", egressId: liveSession.egressId })
    }

    console.log("[egress] starting egress for room:", liveSession.roomName, "session:", id)

    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      bucket: process.env.AWS_S3_BUCKET!,
      region: process.env.AWS_REGION ?? "eu-west-2",
    })
    const fileOutput = new EncodedFileOutput({
      filepath: `recordings/${id}.mp4`,
      output: { case: "s3", value: s3Upload },
    })

    const info = await egressClient().startRoomCompositeEgress(liveSession.roomName, { file: fileOutput })
    console.log("[egress] started successfully, egressId:", info.egressId)

    await prisma.liveSession.update({
      where: { id },
      data: {
        egressId: info.egressId,
        recordingKey: `recordings/${id}.mp4`,
      },
    })

    return NextResponse.json({ egressId: info.egressId })
  } catch (err) {
    console.error("[egress] startEgress failed", err)
    return NextResponse.json({ message: "Failed to start recording" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
