import { NextRequest, NextResponse } from "next/server"
import { freePreviewOpen } from "@/lib/course-visibility"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import { attemptsLeft, hasMultipleAnswers, isSignTest, revealsAnswers, sameWord, signQuestionsForStudent } from "@/lib/quiz"

// POST /api/student/lessons/[id]/quiz/attempt
// body: { answers: { questionId: string; optionId?: string; optionIds?: string[]; text?: string }[]; durationMs?: number }
// `optionIds` are the options ticked on a question with more than one correct
// answer (`optionId` alone is one choice). `text` is the word typed or picked
// in a fingerspelling or vocabulary test.
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
          include: {
            questions: { include: { options: { select: { id: true, isCorrect: true } } } },
          },
        },
      },
    })
    // A test that has not been released yet cannot be read or taken.
    if (!lesson?.test || lesson.type !== "QUIZ" || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }
    const test = lesson.test

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !freePreviewOpen(lesson, lesson.section.course)) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const body = await req.json() as {
      answers: Array<{ questionId: string; optionId?: string; optionIds?: unknown; text?: string }>
      durationMs?: number
    }

    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      return NextResponse.json({ message: "answers are required" }, { status: 400 })
    }
    if (test.questions.length === 0) {
      return NextResponse.json({ message: "This test has no questions yet" }, { status: 400 })
    }

    const previous = await prisma.quizAttempt.findMany({
      where: { lessonId: id, userId: session.sub },
      select: { passed: true },
    })
    if (attemptsLeft(test.maxAttempts, previous.length) === 0) {
      return NextResponse.json({ message: "You have used all your attempts for this test" }, { status: 409 })
    }

    // Grade the attempt
    const kind = test.testKind
    const answerMap = new Map(body.answers.map((a) => [a.questionId, a]))
    let correct = 0

    const gradedAnswers = test.questions.map((q) => {
      const given = answerMap.get(q.id)
      if (isSignTest(kind)) {
        // The question's text is the word; a sign that ran out of time has none.
        const answerText = typeof given?.text === "string" ? given.text.trim().slice(0, 100) : ""
        const isCorrect = sameWord(answerText, q.question)
        if (isCorrect) correct++
        return { questionId: q.id, optionId: null, answerText: answerText || null, isCorrect }
      }
      // Only options of this question count; anything else is ignored, and
      // nothing left means unanswered.
      const ids = Array.isArray(given?.optionIds) ? given.optionIds : given?.optionId ? [given.optionId] : []
      const chosen = q.options.filter((o) => ids.includes(o.id))
      if (!hasMultipleAnswers(q.options)) {
        // One answer: the first option sent is the one chosen.
        const selectedOption = q.options.find((o) => o.id === ids[0])
        const isCorrect = selectedOption?.isCorrect ?? false
        if (isCorrect) correct++
        return { questionId: q.id, optionId: selectedOption?.id ?? null, isCorrect }
      }
      // Several answers: right only when every correct one is ticked and nothing else.
      const isCorrect = chosen.length > 0 && chosen.every((o) => o.isCorrect)
        && chosen.length === q.options.filter((o) => o.isCorrect).length
      if (isCorrect) correct++
      return { questionId: q.id, optionId: chosen[0]?.id ?? null, optionIds: chosen.map((o) => o.id), isCorrect }
    })

    const durationMs = Number.isFinite(body.durationMs) && Number(body.durationMs) > 0
      ? Math.min(Math.round(Number(body.durationMs)), 24 * 60 * 60 * 1000)
      : null

    const total = test.questions.length
    const score = Math.round((correct / total) * 100)
    const passed = score >= test.passMark

    const attempt = await prisma.quizAttempt.create({
      data: {
        lessonId: id,
        userId: session.sub,
        score,
        passed,
        durationMs,
        answers: { create: gradedAnswers },
      },
      include: {
        answers: { select: { questionId: true, optionId: true, optionIds: true, answerText: true, isCorrect: true } },
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
    const left = attemptsLeft(test.maxAttempts, attempts.length)

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
    const reveal = revealsAnswers(test.maxAttempts, attempts)
    const fullQuestions = await prisma.quizQuestion.findMany({
      where: { testId: test.id },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    })
    const questions = isSignTest(kind)
      ? signQuestionsForStudent(kind, fullQuestions, reveal)
      : fullQuestions.map((q) => ({
          ...q,
          multiple: hasMultipleAnswers(q.options),
          options: q.options.map(({ isCorrect, ...option }) => (reveal ? { ...option, isCorrect } : option)),
        }))

    return NextResponse.json({
      attempt, score, passed, correct, total,
      passMark: test.passMark,
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
