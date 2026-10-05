import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import { attemptsLeft, revealsAnswers } from "@/lib/quiz"

// GET /api/student/lessons/[id]/quiz — the test as the student sits it, plus
// their own history. Correct answers are only included once they may be shown
// (see revealsAnswers).
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { section: { select: { courseId: true } } },
    })
    // A test that has not been released yet cannot be read or taken.
    if (!lesson || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }

    // Verify access
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !lesson.isFree) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const [fullQuestions, attempts] = await Promise.all([
      prisma.quizQuestion.findMany({
        where: { lessonId: id },
        orderBy: { order: "asc" },
        include: {
          options: {
            orderBy: { order: "asc" },
            select: { id: true, text: true, imageUrl: true, mediaType: true, order: true, isCorrect: true },
          },
        },
      }),
      prisma.quizAttempt.findMany({
        where: { lessonId: id, userId: session.sub },
        orderBy: { createdAt: "desc" },
        select: { id: true, score: true, passed: true, createdAt: true },
      }),
    ])

    const reveal = attempts.length > 0 && revealsAnswers(lesson.maxAttempts, attempts)
    const questions = fullQuestions.map((q) => ({
      ...q,
      options: q.options.map(({ isCorrect, ...option }) => (reveal ? { ...option, isCorrect } : option)),
    }))

    // Best attempt so far — the most recent one when two share a score.
    const best = [...attempts].sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime())[0]
    const bestAttempt = best
      ? {
          ...best,
          answers: await prisma.quizAttemptAnswer.findMany({
            where: { attemptId: best.id },
            select: { questionId: true, optionId: true, isCorrect: true },
          }),
        }
      : null

    return NextResponse.json({
      questions,
      settings: { passMark: lesson.passMark, maxAttempts: lesson.maxAttempts },
      attempts,
      attemptsLeft: attemptsLeft(lesson.maxAttempts, attempts.length),
      answersRevealed: reveal,
      bestAttempt,
    })
  } catch (err) {
    console.error("[GET /api/student/lessons/[id]/quiz]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
