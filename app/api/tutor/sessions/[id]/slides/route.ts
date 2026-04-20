import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"

// Mime types that identify a presentation resource (slides or video). The
// classroom viewer dispatches on the mime when rendering, so the API just
// needs to allow every format the upload flow accepts.
const PPT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]

// ─── GET /api/tutor/sessions/[id]/slides ─────────────────────────────────────
// Returns the current presentation resource for the session (tutor only)

async function handleGET(
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

    const resource = await prisma.liveSessionResource.findFirst({
      where: { sessionId: id, mimeType: { in: PPT_MIME_TYPES } },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ resource: resource ?? null })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/slides]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// ─── POST /api/tutor/sessions/[id]/slides ────────────────────────────────────
// Saves (or replaces) the presentation file for the session

async function handlePOST(
  req: NextRequest,
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

    const body = await req.json() as {
      fileUrl: string
      fileName: string
      mimeType: string
      fileSize?: number
    }

    if (!body.fileUrl || !body.fileName || !body.mimeType) {
      return NextResponse.json(
        { message: "fileUrl, fileName, and mimeType are required" },
        { status: 400 }
      )
    }

    // Delete existing presentation resources for this session before saving new one
    await prisma.liveSessionResource.deleteMany({
      where: { sessionId: id, mimeType: { in: PPT_MIME_TYPES } },
    })

    const resource = await prisma.liveSessionResource.create({
      data: {
        sessionId: id,
        title:     "__presentation__",
        fileUrl:   body.fileUrl,
        fileName:  body.fileName,
        mimeType:  body.mimeType,
        fileSize:  body.fileSize ?? null,
      },
    })

    return NextResponse.json({ resource }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/slides]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
