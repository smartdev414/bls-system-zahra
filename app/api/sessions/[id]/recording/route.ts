import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { getPresignedDownloadUrl } from "@/lib/s3"

export async function GET(
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

    const key = liveSession.recordingUrl
    if (!key) return NextResponse.json({ message: "No recording available" }, { status: 404 })

    const url = await getPresignedDownloadUrl(key)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/recording]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
