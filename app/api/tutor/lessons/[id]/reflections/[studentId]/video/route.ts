import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { ANSWER_VIDEO_TYPES, ASSESSMENT_VIDEO_MAX_BYTES, answerVideoKey } from "@/lib/test-recordings"
import { teachableReflection } from "../../access"

// POST /api/tutor/lessons/[id]/reflections/[studentId]/video — { contentType, fileSize }
// Somewhere to upload a teacher's filmed feedback on a self-reflection: a
// presigned PUT into the student's own folder for this lesson, so only the
// student and the course's teachers can watch it, and it is deleted with
// their test recordings. The URL is then sent with the feedback.
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const { id, studentId } = await params
    const lesson = await teachableReflection(session, id)
    if (!lesson) return NextResponse.json({ message: "Not found" }, { status: 404 })
    const submission = await prisma.reflectionSubmission.findUnique({
      where: { lessonId_userId: { lessonId: id, userId: studentId } },
      select: { status: true },
    })
    if (submission?.status !== "SUBMITTED") {
      return NextResponse.json({ message: "The student hasn't sent this to you yet." }, { status: 409 })
    }

    const { contentType, fileSize } = await req.json().catch(() => ({})) as { contentType?: string; fileSize?: number }
    const type = typeof contentType === "string" ? contentType.split(";")[0].trim() : ""
    if (!ANSWER_VIDEO_TYPES[type]) {
      return NextResponse.json({ message: "That video format is not supported" }, { status: 400 })
    }
    if (!Number.isFinite(fileSize) || Number(fileSize) <= 0 || Number(fileSize) > ASSESSMENT_VIDEO_MAX_BYTES) {
      return NextResponse.json({ message: "The video is too big to upload" }, { status: 400 })
    }

    const key = answerVideoKey(id, studentId, type)
    const presignedUrl = await getPresignedUploadUrl(key, type)
    return NextResponse.json({ presignedUrl, fileUrl: publicUrl(key), contentType: type })
  } catch (err) {
    console.error("[POST /api/tutor/lessons/[id]/reflections/[studentId]/video]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
