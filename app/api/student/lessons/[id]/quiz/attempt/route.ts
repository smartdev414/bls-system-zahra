import { NextRequest, NextResponse } from "next/server"
import { freePreviewOpen } from "@/lib/course-visibility"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import {
  attemptScore, attemptsLeft, hasMultipleAnswers, isSignTest, questionsForStudent, revealsAnswers, sameWord,
  signQuestionsForStudent,
} from "@/lib/quiz"
import { isOwnAnswerVideo } from "@/lib/test-recordings"

// POST /api/student/lessons/[id]/quiz/attempt
// body: { answers: { questionId: string; optionId?: string; optionIds?: string[]; text?: string; videoUrl?: string }[]; durationMs?: number }
// `optionIds` are the options ticked on a question with more than one correct
// answer (`optionId` alone is one choice). `text` is the word typed or picked
// in a fingerspelling or vocabulary test, or a written answer. `videoUrl` is
// the student's recording for a signed answer (from ./recording).
//
// Written and signed answers are left unmarked: the attempt waits for the
// student to mark them (PATCH ./[attemptId]) before it can pass.
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
      answers: Array<{ questionId: string; optionId?: string; optionIds?: unknown; text?: string; videoUrl?: unknown }>
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
      select: { passed: true, selfMarked: true },
    })
    if (attemptsLeft(test.maxAttempts, previous.length) === 0) {
      return NextResponse.json({ message: "You have used all your attempts for this test" }, { status: 409 })
    }
    if (previous.some((a) => !a.selfMarked)) {
      return NextResponse.json({ message: "Mark your answers from last time first" }, { status: 409 })
    }

    // Grade the attempt
    const kind = test.testKind
    const answerMap = new Map(body.answers.map((a) => [a.questionId, a]))

    const gradedAnswers = test.questions.map((q) => {
      const given = answerMap.get(q.id)
      if (isSignTest(kind)) {
        // The question's text is the word; a sign that ran out of time has none.
        const answerText = typeof given?.text === "string" ? given.text.trim().slice(0, 100) : ""
        const isCorrect = sameWord(answerText, q.question)
        return { questionId: q.id, optionId: null, answerText: answerText || null, isCorrect }
      }
      // Marked by the student once they see the model answer. Nothing given
      // (a blank box, no recording) has nothing to mark, and gets 0 now.
      if (q.type === "WRITTEN") {
        const answerText = typeof given?.text === "string" ? given.text.trim().slice(0, 5000) : ""
        return { questionId: q.id, optionId: null, answerText: answerText || null, marks: answerText ? null : 0, isCorrect: false }
      }
      if (q.type === "SIGN") {
        const videoUrl = isOwnAnswerVideo(given?.videoUrl, id, session.sub) ? given.videoUrl : null
        return { questionId: q.id, optionId: null, videoUrl, marks: videoUrl ? null : 0, isCorrect: false }
      }
      // Only options of this question count; anything else is ignored, and
      // nothing left means unanswered.
      const ids = Array.isArray(given?.optionIds) ? given.optionIds : given?.optionId ? [given.optionId] : []
      const chosen = q.options.filter((o) => ids.includes(o.id))
      if (!hasMultipleAnswers(q.options)) {
        // One answer: the first option sent is the one chosen.
        const selectedOption = q.options.find((o) => o.id === ids[0])
        const isCorrect = selectedOption?.isCorrect ?? false
        return { questionId: q.id, optionId: selectedOption?.id ?? null, isCorrect }
      }
      // Several answers: right only when every correct one is ticked and nothing else.
      const isCorrect = chosen.length > 0 && chosen.every((o) => o.isCorrect)
        && chosen.length === q.options.filter((o) => o.isCorrect).length
      return { questionId: q.id, optionId: chosen[0]?.id ?? null, optionIds: chosen.map((o) => o.id), isCorrect }
    })

    const durationMs = Number.isFinite(body.durationMs) && Number(body.durationMs) > 0
      ? Math.min(Math.round(Number(body.durationMs)), 24 * 60 * 60 * 1000)
      : null

    // Out of the marks available — 1 a question, up to 3 for a written answer.
    const { earned: correct, total, score } = attemptScore(test.questions, gradedAnswers)
    // Until the student has marked their written and signed answers it cannot pass.
    const selfMarked = gradedAnswers.every((a) => !("marks" in a) || a.marks !== null)
    const passed = selfMarked && score >= test.passMark

    const attempt = await prisma.quizAttempt.create({
      data: {
        lessonId: id,
        userId: session.sub,
        score,
        passed,
        durationMs,
        selfMarked,
        answers: { create: gradedAnswers },
      },
      include: {
        answers: {
          select: { questionId: true, optionId: true, optionIds: true, answerText: true, videoUrl: true, marks: true, markedByTutor: true, isCorrect: true },
        },
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

    // Notify the student of their quiz result — once they have marked it, if
    // there is marking to do.
    if (selfMarked) void createNotification(
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
      : questionsForStudent(fullQuestions, reveal, true)

    return NextResponse.json({
      attempt, score, passed, correct, total, selfMarked,
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
