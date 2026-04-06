import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]

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
        { message: "Only PDF and PowerPoint files are allowed" },
        { status: 400 }
      )
    }

    const ext = body.mimeType === "application/pdf" ? "pdf" : "pptx"
    const key = `slides/${id}/presentation.${ext}`

    const uploadUrl = await getPresignedUploadUrl(key, body.mimeType)
    const fileUrl   = publicUrl(key)

    return NextResponse.json({ uploadUrl, fileUrl, key })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/slides/presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
