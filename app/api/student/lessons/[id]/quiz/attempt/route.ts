import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import { attemptsLeft, revealsAnswers } from "@/lib/quiz"

// POST /api/student/lessons/[id]/quiz/attempt
// body: { answers: { questionId: string; optionId: string }[] }
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
    if (!lesson || lesson.type !== "QUIZ" || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !lesson.isFree) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const body = await req.json() as {
      answers: Array<{ questionId: string; optionId: string }>
    }

    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      return NextResponse.json({ message: "answers are required" }, { status: 400 })
    }
    if (lesson.questions.length === 0) {
      return NextResponse.json({ message: "This test has no questions yet" }, { status: 400 })
    }

    const previous = await prisma.quizAttempt.findMany({
      where: { lessonId: id, userId: session.sub },
      select: { passed: true },
    })
    if (attemptsLeft(lesson.maxAttempts, previous.length) === 0) {
      return NextResponse.json({ message: "You have used all your attempts for this test" }, { status: 409 })
    }

    // Grade the attempt
    const answerMap = new Map(body.answers.map((a) => [a.questionId, a.optionId]))
    let correct = 0

    const gradedAnswers = lesson.questions.map((q) => {
      const selectedOption = q.options.find((o) => o.id === answerMap.get(q.id))
      const isCorrect = selectedOption?.isCorrect ?? false
      if (isCorrect) correct++
      // Only an option of this question is stored; anything else counts as unanswered.
      return { questionId: q.id, optionId: selectedOption?.id ?? null, isCorrect }
    })

    const total = lesson.questions.length
    const score = Math.round((correct / total) * 100)
    const passed = score >= lesson.passMark

    const attempt = await prisma.quizAttempt.create({
      data: {
        lessonId: id,
        userId: session.sub,
        score,
        passed,
        answers: { create: gradedAnswers },
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

    const attempts = [...previous, { passed }]
    const left = attemptsLeft(lesson.maxAttempts, attempts.length)

    // Notify the student of their quiz result
    void createNotification(
      session.sub,
      passed ? "QUIZ_PASSED" : "QUIZ_FAILED",
      passed ? `Test passed — ${score}%` : `Test not passed — ${score}%`,
      passed
        ? `You scored ${correct}/${total} on "${lesson.title}". Keep it up!`
        : left === 0
          ? `You scored ${correct}/${total} on "${lesson.title}". You have no attempts left — speak to your teacher.`
          : `You scored ${correct}/${total} on "${lesson.title}". Review and try again.`,
      `/student/lessons/${id}`,
    )

    // The questions to review against — with the correct answers only when the
    // student may see them.
    const reveal = revealsAnswers(lesson.maxAttempts, attempts)
    const fullQuestions = await prisma.quizQuestion.findMany({
      where: { lessonId: id },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    })
    const questions = fullQuestions.map((q) => ({
      ...q,
      options: q.options.map(({ isCorrect, ...option }) => (reveal ? { ...option, isCorrect } : option)),
    }))

    return NextResponse.json({
      attempt, score, passed, correct, total,
      passMark: lesson.passMark,
      attemptsLeft: left,
      answersRevealed: reveal,
      questions,
    })
  } catch (err) {
    console.error("[POST /api/student/lessons/[id]/quiz/attempt]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
