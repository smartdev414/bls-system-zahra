import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { attemptsLeft, awaitsMarks, isAssessment, questionMarking } from "@/lib/quiz"
import { rescoreAttempt } from "@/lib/test-marking"

// PATCH /api/student/lessons/[id]/quiz/attempt/[attemptId]
// body: { marks: { [questionId]: number } }
// The student marks their written and signed answers (and the words they
// signed in a vocabulary test) against the model answer, all together. Once marked they are theirs no longer to change — a
// teacher can (PATCH /api/tutor/lessons/[id]/results/answers/[answerId]).
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attemptId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id, attemptId } = await params
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: attemptId, lessonId: id, userId: session.sub },
      select: {
        id: true, selfMarked: true,
        lesson: { select: { title: true, test: { select: { maxAttempts: true, testKind: true, vocabularyMode: true, tutorMarks: true } } } },
        answers: { select: { id: true, questionId: true, marks: true, question: { select: { type: true, maxMarks: true } } } },
      },
    })
    if (!attempt) return NextResponse.json({ message: "Attempt not found" }, { status: 404 })
    if (attempt.selfMarked || !attempt.lesson.test) return NextResponse.json({ message: "This attempt has been marked already" }, { status: 409 })
    const test = attempt.lesson.test
    if (isAssessment(test.testKind) && test.tutorMarks) {
      return NextResponse.json({ message: "Your teacher marks this test" }, { status: 403 })
    }

    const { marks } = await req.json() as { marks?: Record<string, unknown> }
    const toMark = attempt.answers.filter((a) => awaitsMarks(a.question, a, test))
    for (const answer of toMark) {
      const given = Number(marks?.[answer.questionId])
      if (!Number.isInteger(given) || given < 0 || given > questionMarking(answer.question, test).self) {
        return NextResponse.json({ message: "Mark every answer before you finish" }, { status: 400 })
      }
    }

    await prisma.$transaction(toMark.map((answer) => {
      const given = Number(marks![answer.questionId])
      const { picked, self } = questionMarking(answer.question, test)
      return prisma.quizAttemptAnswer.update({
        where: { id: answer.id },
        // Where a word was also picked, isCorrect stays what the server made it.
        data: { marks: given, ...(!picked && { isCorrect: given === self }) },
      })
    }))

    const result = await rescoreAttempt(attemptId)

    const used = await prisma.quizAttempt.count({ where: { lessonId: id, userId: session.sub } })
    const left = attemptsLeft(attempt.lesson.test?.maxAttempts ?? null, used)
    const scored = `You scored ${result.earned}/${result.total} on "${attempt.lesson.title}".`
    void createNotification(
      session.sub,
      result.passed ? "QUIZ_PASSED" : "QUIZ_FAILED",
      result.passed ? `Test passed — ${result.score}%` : `Test not passed — ${result.score}%`,
      result.passed
        ? `${scored} Keep it up!`
        : left === 0
          ? `${scored} You have no attempts left — speak to your teacher.`
          : `${scored} Review and try again.`,
      `/student/lessons/${id}`,
    )

    return NextResponse.json({ ...result, attemptsLeft: left })
  } catch (err) {
    console.error("[PATCH /api/student/lessons/[id]/quiz/attempt/[attemptId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
