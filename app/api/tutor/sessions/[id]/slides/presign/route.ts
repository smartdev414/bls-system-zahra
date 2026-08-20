import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"
import { sanitizeUploadFileName } from "@/lib/upload-filename"

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]

// Mime → storage extension. Keyed on the full mime so the classroom viewer can
// sniff the URL and pick the right renderer (slides vs. video).
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

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

    const body = await req.json() as { fileName: string; mimeType: string }

    if (!body.fileName || !body.mimeType) {
      return NextResponse.json({ message: "fileName and mimeType are required" }, { status: 400 })
    }

    if (!ALLOWED_MIME_TYPES.includes(body.mimeType)) {
      return NextResponse.json(
        { message: "Only PDF, PowerPoint, and video files (MP4/MOV/WebM) are allowed" },
        { status: 400 }
      )
    }

    const ext = MIME_EXTENSIONS[body.mimeType]
    // Prefer the original basename so downloads show the real name; fall back to
    // presentation.<ext> when the client sends an empty/odd name. Always keep
    // the mime-derived extension so the classroom viewer can sniff the URL.
    const safeBase = sanitizeUploadFileName(body.fileName)
    const bare = safeBase.includes(".")
      ? safeBase.slice(0, safeBase.lastIndexOf("."))
      : safeBase
    const leaf = `${bare || "presentation"}.${ext}`
    const key = `slides/${id}/${leaf}`

    const uploadUrl = await getPresignedUploadUrl(key, body.mimeType)
    const fileUrl   = publicUrl(key)

    return NextResponse.json({ uploadUrl, fileUrl, key })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/slides/presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
