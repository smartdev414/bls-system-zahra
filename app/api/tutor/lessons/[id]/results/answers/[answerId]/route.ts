import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseTeachScope } from "@/lib/permissions"
import { isAssessment, questionMarking } from "@/lib/quiz"
import { notifyStudentMarked, rescoreAttempt } from "@/lib/test-marking"
import { isOwnAnswerVideo, keyOfUrl } from "@/lib/test-recordings"
import { deleteObject } from "@/lib/s3"

// PATCH /api/tutor/lessons/[id]/results/answers/[answerId] — { marks: number } or { feedbackVideoUrl: string | null }
// A teacher changes the marks a student gave themselves on a written or
// signed answer, or a word signed in a vocabulary test (or gives them, if the student never did). The attempt's score
// and pass follow. On a filmed answer (an assessment's part, a presentation)
// they can also keep, replace or remove the feedback they recorded over it
// (uploaded via ./feedback).
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Teaching staff only — the same people who can see the answers.
    if (!can(session.role, "students.view") || !can(session.role, "resources.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, answerId } = await params
    const answer = await prisma.quizAttemptAnswer.findFirst({
      where: {
        id: answerId,
        attempt: { lessonId: id, lesson: { type: "QUIZ", section: { course: courseTeachScope(session) } } },
      },
      select: {
        id: true, attemptId: true, feedbackVideoUrl: true,
        attempt: { select: { selfMarked: true, userId: true } },
        question: { select: { type: true, maxMarks: true, test: { select: { testKind: true, vocabularyMode: true, tutorMarks: true } } } },
      },
    })
    if (!answer) return NextResponse.json({ message: "Answer not found" }, { status: 404 })
    const { picked, self: max } = questionMarking(answer.question, answer.question.test)
    if (max === 0) {
      return NextResponse.json({ message: "Only written and signed answers are marked by hand" }, { status: 400 })
    }

    const { marks, feedbackVideoUrl } = await req.json() as { marks?: unknown; feedbackVideoUrl?: unknown }

    if (feedbackVideoUrl !== undefined) {
      if (!isAssessment(answer.question.test.testKind)) {
        return NextResponse.json({ message: "Feedback is recorded on filmed answers only" }, { status: 400 })
      }
      if (feedbackVideoUrl !== null && !isOwnAnswerVideo(feedbackVideoUrl, id, answer.attempt.userId)) {
        return NextResponse.json({ message: "That is not a feedback video for this student" }, { status: 400 })
      }
      await prisma.quizAttemptAnswer.update({ where: { id: answerId }, data: { feedbackVideoUrl } })
      // The one it replaces is not kept.
      const old = answer.feedbackVideoUrl && answer.feedbackVideoUrl !== feedbackVideoUrl ? keyOfUrl(answer.feedbackVideoUrl) : null
      if (old) void deleteObject(old).catch((err) => console.error("[feedback] deleting the old video", old, err))
      return NextResponse.json({ feedbackVideoUrl })
    }

    if (!Number.isInteger(marks) || (marks as number) < 0 || (marks as number) > max) {
      return NextResponse.json({ message: `Marks must be from 0 to ${max}` }, { status: 400 })
    }

    await prisma.quizAttemptAnswer.update({
      where: { id: answerId },
      data: { marks: marks as number, markedByTutor: true, ...(!picked && { isCorrect: marks === max }) },
    })
    const result = await rescoreAttempt(answer.attemptId)
    // The last mark of an assessment a teacher marks: the student gets their result.
    if (isAssessment(answer.question.test.testKind) && answer.question.test.tutorMarks && !answer.attempt.selfMarked && result.selfMarked) {
      void notifyStudentMarked(answer.attemptId)
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error("[PATCH /api/tutor/lessons/[id]/results/answers/[answerId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
