import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { getPresignedDownloadUrl, listObjectKeys } from "@/lib/s3"
import { withAudit } from "@/lib/audit"

// Segments share a prefix: `recordings/{id}.mp4`, `recordings/{id}-2.mp4`, …
// We list them by prefix and order them numerically (segment 1 is the bare
// file; subsequent segments carry a "-N" suffix). The client chains them
// together in a single <video> element so the student sees one continuous
// recording without any of the paused/break time.
function segmentNumber(key: string, sessionId: string): number {
  // Strip the bucket-prefix and extension to inspect just the suffix.
  // Examples:
  //   recordings/abc123.mp4         -> 1
  //   recordings/abc123-2.mp4       -> 2
  //   recordings/abc123-10.mp4      -> 10
  const base = `recordings/${sessionId}`
  if (key === `${base}.mp4`) return 1
  const m = key.match(new RegExp(`^${base}-(\\d+)\\.mp4$`))
  if (m) return parseInt(m[1], 10)
  return Number.POSITIVE_INFINITY  // unknown → sink to the end
}

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

    // List every segment for this session and sort numerically.
    const keys = await listObjectKeys(`recordings/${id}`)
    const mp4Keys = keys
      .filter((k) => k.endsWith(".mp4"))
      .sort((a, b) => segmentNumber(a, id) - segmentNumber(b, id))

    if (mp4Keys.length === 0) {
      // Fallback to the legacy single-file pointer for older recordings that
      // predate segmented capture, just in case the listing returned nothing.
      const legacyKey = liveSession.recordingUrl
      if (!legacyKey) return NextResponse.json({ message: "No recording available" }, { status: 404 })
      const url = await getPresignedDownloadUrl(legacyKey)
      return NextResponse.json({ url, segments: [url] })
    }

    const segments = await Promise.all(mp4Keys.map((k) => getPresignedDownloadUrl(k)))

    // `url` stays for backward compatibility with callers that only consume
    // a single source; `segments` is the canonical ordered list.
    return NextResponse.json({ url: segments[0], segments })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/recording]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
