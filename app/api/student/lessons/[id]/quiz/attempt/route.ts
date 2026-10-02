import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"

// POST /api/student/lessons/[id]/quiz/attempt
// body: { enrollmentId: string; answers: { questionId: string; optionId: string }[] }
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
        section: { select: { courseId: true } },
        questions: {
          include: { options: { select: { id: true, isCorrect: true } } },
        },
      },
    })
    // A test that has not been released yet cannot be read or taken.
    if (!lesson || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !lesson.isFree) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const body = await req.json() as {
      enrollmentId: string
      answers: Array<{ questionId: string; optionId: string }>
    }

    if (!body.answers?.length) {
      return NextResponse.json({ message: "answers are required" }, { status: 400 })
    }

    // Grade the attempt
    const answerMap = new Map(body.answers.map((a) => [a.questionId, a.optionId]))
    let correct = 0

    const gradedAnswers = lesson.questions.map((q) => {
      const selectedOptionId = answerMap.get(q.id) ?? null
      const selectedOption = q.options.find((o) => o.id === selectedOptionId)
      const isCorrect = selectedOption?.isCorrect ?? false
      if (isCorrect) correct++
      return { questionId: q.id, optionId: selectedOptionId, isCorrect }
    })

    const total = lesson.questions.length
    const score = total > 0 ? Math.round((correct / total) * 100) : 0
    const passed = score >= 70

    const attempt = await prisma.quizAttempt.create({
      data: {
        lessonId: id,
        userId: session.sub,
        score,
        passed,
        answers: {
          create: gradedAnswers.map((a) => ({
            questionId: a.questionId,
            optionId: a.optionId,
            isCorrect: a.isCorrect,
          })),
        },
      },
      include: {
        answers: { select: { questionId: true, optionId: true, isCorrect: true } },
      },
    })

    // Auto-complete lesson if passed
    if (passed && enrollment) {
      await prisma.lessonProgress.upsert({
        where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: id } },
        create: { enrollmentId: enrollment.id, lessonId: id, isCompleted: true, completedAt: new Date() },
        update: { isCompleted: true, completedAt: new Date() },
      })
    }

    // Notify the student of their quiz result
    void createNotification(
      session.sub,
      passed ? "QUIZ_PASSED" : "QUIZ_FAILED",
      passed ? `Quiz passed — ${score}%` : `Quiz failed — ${score}%`,
      passed
        ? `You scored ${correct}/${total} on "${lesson.title}". Keep it up!`
        : `You scored ${correct}/${total} on "${lesson.title}". Review and try again.`,
      `/student/lessons/${id}`,
    )

    // Fetch correct answers to return with result
    const questionsWithAnswers = await prisma.quizQuestion.findMany({
      where: { lessonId: id },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    })

    return NextResponse.json({ attempt, score, passed, correct, total, questions: questionsWithAnswers })
  } catch (err) {
    console.error("[POST /api/student/lessons/[id]/quiz/attempt]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
