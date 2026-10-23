import { NextRequest, NextResponse } from "next/server"
import { freePreviewOpen } from "@/lib/course-visibility"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { signsWords } from "@/lib/quiz"
import { ANSWER_VIDEO_MAX_BYTES, ANSWER_VIDEO_TYPES, answerVideoKey } from "@/lib/test-recordings"

// POST /api/student/lessons/[id]/quiz/recording — { contentType, fileSize }
// Somewhere to upload the student's recording of a signed answer, or of a
// word signed in a vocabulary test: a presigned
// PUT into their own private folder for this test (lib/test-recordings.ts).
// The URL that comes back is sent with the attempt.
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        section: { select: { courseId: true, course: { select: { status: true, visibility: true } } } },
        test: {
          select: { testKind: true, vocabularyMode: true, questions: { where: { type: "SIGN" }, select: { id: true }, take: 1 } },
        },
      },
    })
    if (!lesson?.test || lesson.type !== "QUIZ" || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }
    if (lesson.test.questions.length === 0 && !signsWords(lesson.test)) {
      return NextResponse.json({ message: "This test has nothing to film" }, { status: 400 })
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
      select: { id: true },
    })
    if (!enrollment && !freePreviewOpen(lesson, lesson.section.course)) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const { contentType, fileSize } = await req.json() as { contentType?: string; fileSize?: number }
    const type = typeof contentType === "string" ? contentType.split(";")[0].trim() : ""
    if (!ANSWER_VIDEO_TYPES[type]) {
      return NextResponse.json({ message: "That video format is not supported" }, { status: 400 })
    }
    if (!Number.isFinite(fileSize) || Number(fileSize) <= 0 || Number(fileSize) > ANSWER_VIDEO_MAX_BYTES) {
      return NextResponse.json({ message: "The video is too long — keep it to the one sign" }, { status: 400 })
    }

    const key = answerVideoKey(id, session.sub, type)
    const presignedUrl = await getPresignedUploadUrl(key, type)
    return NextResponse.json({ presignedUrl, fileUrl: publicUrl(key), contentType: type })
  } catch (err) {
    console.error("[POST /api/student/lessons/[id]/quiz/recording]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
