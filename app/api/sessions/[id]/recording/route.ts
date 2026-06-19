import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { getPresignedDownloadUrl } from "@/lib/s3"
import { reconcileSessionRecording } from "@/lib/recording"
import { withAudit } from "@/lib/audit"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: {
        id,
        OR: [
          { tutorId: session.sub },
          { attendances: { some: { studentId: session.sub } } },
        ],
      },
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

    const segments = await Promise.all(existingKeys.map((k) => getPresignedDownloadUrl(k)))

    // `url` stays for backward compatibility with callers that only consume
    // a single source; `segments` is the canonical ordered list.
    return NextResponse.json({ url: segments[0], segments })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/recording]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
