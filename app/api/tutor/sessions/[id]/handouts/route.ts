import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { announceHandouts, classEnd } from "@/lib/class-handouts"

type Ctx = { params: Promise<{ id: string }> }

/** The class, when the signed-in tutor runs it. */
async function ownClass(id: string) {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "TUTOR" && session.role !== "ADMIN") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }
  const liveSession = await prisma.liveSession.findFirst({
    where: { id, ...hostedBy(session.sub) },
    select: { id: true, scheduledAt: true, durationMins: true },
  })
  if (!liveSession) return { error: NextResponse.json({ message: "Session not found" }, { status: 404 }) }
  return { liveSession }
}

async function handleGET(_req: NextRequest, { params }: Ctx) {
  try {
    const { liveSession, error } = await ownClass((await params).id)
    if (error) return error
    const handouts = await prisma.classHandout.findMany({
      where: { sessionId: liveSession.id },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({ handouts, classEndsAt: classEnd(liveSession).toISOString() })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/handouts]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// Adds uploaded files as handouts, all opening at the same date and time.
async function handlePOST(req: NextRequest, { params }: Ctx) {
  try {
    const { liveSession, error } = await ownClass((await params).id)
    if (error) return error

    const body = await req.json().catch(() => ({})) as {
      releaseAt?: string
      files?: { fileUrl?: string; fileName?: string; fileSize?: number; mimeType?: string }[]
    }
    const files = (body.files ?? []).filter((f) => f.fileUrl && f.fileName)
    if (!files.length) return NextResponse.json({ message: "Upload a file first" }, { status: 400 })
    const releaseAt = body.releaseAt ? new Date(body.releaseAt) : classEnd(liveSession)
    if (isNaN(releaseAt.getTime())) return NextResponse.json({ message: "Pick a valid date and time" }, { status: 400 })

    await prisma.classHandout.createMany({
      data: files.map((f) => ({
        sessionId: liveSession.id,
        // The name students see: the file's, without its extension.
        title: f.fileName!.replace(/\.[^.]+$/, "") || f.fileName!,
        fileUrl: f.fileUrl!,
        fileName: f.fileName!,
        fileSize: f.fileSize ?? null,
        mimeType: f.mimeType ?? null,
        releaseAt,
      })),
    })
    // Already open: tell the students now rather than at the next reminders run.
    if (releaseAt <= new Date()) await announceHandouts(new Date(), liveSession.id)

    const handouts = await prisma.classHandout.findMany({
      where: { sessionId: liveSession.id },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({ handouts }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/handouts]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(tutorWrite("calendar", handlePOST))
