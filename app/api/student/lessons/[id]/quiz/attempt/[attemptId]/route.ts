import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { attemptsLeft, isSelfMarked, maxMarks } from "@/lib/quiz"
import { rescoreAttempt } from "@/lib/test-marking"

// PATCH /api/student/lessons/[id]/quiz/attempt/[attemptId]
// body: { marks: { [questionId]: number } }
// The student marks their written and signed answers against the model
// answer, all together. Once marked they are theirs no longer to change — a
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
        lesson: { select: { title: true, test: { select: { maxAttempts: true } } } },
        answers: { select: { id: true, questionId: true, marks: true, question: { select: { type: true } } } },
      },
    })
    if (!attempt) return NextResponse.json({ message: "Attempt not found" }, { status: 404 })
    if (attempt.selfMarked) return NextResponse.json({ message: "This attempt has been marked already" }, { status: 409 })

    const { marks } = await req.json() as { marks?: Record<string, unknown> }
    const toMark = attempt.answers.filter((a) => isSelfMarked(a.question.type) && a.marks === null)
    for (const answer of toMark) {
      const given = Number(marks?.[answer.questionId])
      if (!Number.isInteger(given) || given < 0 || given > maxMarks(answer.question.type)) {
        return NextResponse.json({ message: "Mark every answer before you finish" }, { status: 400 })
      }
    }

    await prisma.$transaction(toMark.map((answer) => {
      const given = Number(marks![answer.questionId])
      return prisma.quizAttemptAnswer.update({
        where: { id: answer.id },
        data: { marks: given, isCorrect: given === maxMarks(answer.question.type) },
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
