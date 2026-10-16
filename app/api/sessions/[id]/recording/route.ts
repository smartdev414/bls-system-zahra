import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { mediaGatewayPath } from "@/lib/protected-media"
import { reconcileSessionRecording } from "@/lib/recording"
import { withAudit } from "@/lib/audit"
import { recordingViewers } from "@/lib/session-access"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    // The tutor who ran the class, the students it was for, and admins (who
    // oversee every class, though they don't teach them).
    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...(session.role === "ADMIN" ? {} : recordingViewers(session.sub)) },
    })

    if (!liveSession) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const wasProcessing = !!liveSession.egressId

    const { ready, keys: existingKeys } = await reconcileSessionRecording(id, {
      pollEgress: wasProcessing,
    })

    if (!ready || existingKeys.length === 0) {
      return NextResponse.json(
        { message: wasProcessing ? "Recording is still processing" : "No recording available" },
        { status: 404 },
      )
    }

    // Hand out gateway paths, not signed S3 URLs: each segment is then signed
    // (and the viewer re-checked) at the moment it starts playing, and no
    // long-lived download link ever sits in this response.
    const segments = existingKeys.map(mediaGatewayPath)

    // `url` stays for backward compatibility with callers that only consume
    // a single source; `segments` is the canonical ordered list.
    return NextResponse.json({ url: segments[0], segments })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/recording]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
