import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"

const ALLOWED: Record<string, true> = {
  // Images
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
  "image/gif": true,
  // Video
  "video/mp4": true,
  "video/webm": true,
  "video/quicktime": true,
  // Documents
  "application/pdf": true,
  // PowerPoint
  "application/vnd.ms-powerpoint": true,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
  // Word
  "application/msword": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  // Excel
  "application/vnd.ms-excel": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  // Plain text
  "text/plain": true,
}

// 50 MB cap for classroom chat attachments — large enough for short clips and
// slide decks; full-length videos should go through the Present/resources flow.
const MAX_SIZE = 50 * 1024 * 1024

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getSession()
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id: sessionId } = await params

    const liveSession = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      select: { id: true, tutorId: true, status: true, visibility: true },
    })

    if (!liveSession) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 })
    }

    if (liveSession.status === "CANCELLED" || liveSession.status === "COMPLETED") {
      return NextResponse.json({ message: "Session is no longer active" }, { status: 410 })
    }

    const isTutor = auth.role === "TUTOR" && auth.sub === liveSession.tutorId
    const isStudent = auth.role === "STUDENT"

    if (!isTutor && !isStudent) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    if (isStudent && liveSession.visibility === "INVITE_ONLY") {
      const [invite, approvedRequest] = await Promise.all([
        prisma.liveSessionInvite.findUnique({
          where: { sessionId_studentId: { sessionId, studentId: auth.sub } },
          select: { id: true },
        }),
        prisma.sessionJoinRequest.findFirst({
          where: { sessionId, studentId: auth.sub, status: "APPROVED" },
          select: { id: true },
        }),
      ])
      if (!invite && !approvedRequest) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      }
    }

    const { fileName, contentType, fileSize } = await req.json() as {
      fileName: string
      contentType: string
      fileSize: number
    }

    if (!fileName || !contentType) {
      return NextResponse.json({ message: "fileName and contentType are required" }, { status: 400 })
    }

    if (!ALLOWED[contentType]) {
      return NextResponse.json(
        { message: `File type "${contentType}" is not supported. Use images, video, PDF, Word, PowerPoint, Excel, or text files.` },
        { status: 400 },
      )
    }

    if (fileSize > MAX_SIZE) {
      return NextResponse.json({ message: "File too large (max 50 MB)" }, { status: 400 })
    }

    const ext = fileName.split(".").pop() ?? "bin"
    const key = `classroom-chat/${sessionId}/${auth.sub}/${randomUUID()}.${ext}`

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/chat-upload-presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
