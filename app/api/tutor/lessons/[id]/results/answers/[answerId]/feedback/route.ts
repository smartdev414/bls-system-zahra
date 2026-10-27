import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseTeachScope } from "@/lib/permissions"
import { isAssessment } from "@/lib/quiz"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { ANSWER_VIDEO_TYPES, ASSESSMENT_VIDEO_MAX_BYTES, answerVideoKey } from "@/lib/test-recordings"

// POST /api/tutor/lessons/[id]/results/answers/[answerId]/feedback — { contentType, fileSize }
// Somewhere to upload a teacher's feedback on a filmed answer: a presigned PUT
// into the student's own folder for this test, so the same people can watch
// it (the student and the course's teachers) and it is deleted with their
// recordings (lib/test-recordings.ts). The URL that comes back is then saved
// on the answer with PATCH ../ { feedbackVideoUrl }.
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view") || !can(session.role, "resources.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, answerId } = await params
    const answer = await prisma.quizAttemptAnswer.findFirst({
      where: {
        id: answerId,
        attempt: { lessonId: id, lesson: { type: "QUIZ", section: { course: courseTeachScope(session) } } },
      },
      select: { attempt: { select: { userId: true } }, question: { select: { test: { select: { testKind: true } } } } },
    })
    if (!answer) return NextResponse.json({ message: "Answer not found" }, { status: 404 })
    if (!isAssessment(answer.question.test.testKind)) {
      return NextResponse.json({ message: "Feedback is recorded on filmed answers only" }, { status: 400 })
    }

    const { contentType, fileSize } = await req.json() as { contentType?: string; fileSize?: number }
    const type = typeof contentType === "string" ? contentType.split(";")[0].trim() : ""
    if (!ANSWER_VIDEO_TYPES[type]) {
      return NextResponse.json({ message: "That video format is not supported" }, { status: 400 })
    }
    if (!Number.isFinite(fileSize) || Number(fileSize) <= 0 || Number(fileSize) > ASSESSMENT_VIDEO_MAX_BYTES) {
      return NextResponse.json({ message: "The video is too big to upload" }, { status: 400 })
    }

    const key = answerVideoKey(id, answer.attempt.userId, type)
    const presignedUrl = await getPresignedUploadUrl(key, type)
    return NextResponse.json({ presignedUrl, fileUrl: publicUrl(key), contentType: type })
  } catch (err) {
    console.error("[POST /api/tutor/lessons/[id]/results/answers/[answerId]/feedback]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
