import { NextResponse } from "next/server"
import { freePreviewOpen } from "@/lib/course-visibility"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import {
  DEFAULT_ANSWER_MINUTES, DEFAULT_ANSWER_SECONDS, attemptsLeft, isAssessment, isSignTest, partsForStudent, questionsForStudent,
  revealsAnswers, signQuestionsForStudent,
} from "@/lib/quiz"
import { highScores } from "@/lib/quiz-high-scores"

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
      include: {
        section: { select: { courseId: true, course: { select: { status: true, visibility: true } } } },
        test: true,
      },
    })
    // A test that has not been released yet cannot be read or taken.
    if (!lesson?.test || !isReleased(lesson)) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }
    const test = lesson.test

    // Verify access
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !freePreviewOpen(lesson, lesson.section.course)) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const [fullQuestions, attempts] = await Promise.all([
      prisma.quizQuestion.findMany({
        where: { testId: test.id, ...READY_QUESTION },
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
        select: { id: true, score: true, passed: true, selfMarked: true, createdAt: true },
      }),
    ])

    const reveal = attempts.length > 0 && revealsAnswers(test.maxAttempts, attempts)
    const kind = test.testKind
    // Model answers of written and signed questions are seen once the student
    // has submitted — they mark themselves against them.
    // An assessment a teacher marks shows its answer sheet once they have.
    const showModel = isAssessment(kind) && test.tutorMarks ? attempts.some((a) => a.selfMarked) : attempts.length > 0
    const questions = isSignTest(kind)
      ? signQuestionsForStudent({ testKind: kind, vocabularyMode: test.vocabularyMode }, fullQuestions, reveal, showModel)
      : isAssessment(kind)
      ? partsForStudent(fullQuestions, showModel)
      : questionsForStudent(fullQuestions, reveal, showModel)

    const answersOf = (attemptId: string) => prisma.quizAttemptAnswer.findMany({
      where: { attemptId },
      select: {
        questionId: true, optionId: true, optionIds: true, answerText: true, videoUrl: true,
        marks: true, markedByTutor: true, isCorrect: true,
      },
    })

    // Best attempt so far — the most recent one when two share a score. One
    // still waiting to be marked is not a score yet.
    const best = attempts
      .filter((a) => a.selfMarked)
      .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime())[0]
    const bestAttempt = best ? { ...best, answers: await answersOf(best.id) } : null

    // Submitted, but written or signed answers still to be marked by the student.
    const pending = attempts.find((a) => !a.selfMarked)
    const pendingAttempt = pending ? { ...pending, answers: await answersOf(pending.id) } : null

    return NextResponse.json({
      questions,
      settings: {
        passMark: test.passMark,
        maxAttempts: test.maxAttempts,
        kind,
        answerSeconds: test.answerSeconds ?? DEFAULT_ANSWER_SECONDS,
        signPlays: test.signPlays,
        storyUrl: kind === "STORY" || isAssessment(kind) ? test.storyUrl : null,
        storyControls: test.storyControls,
        vocabularyMode: test.vocabularyMode,
        answerMinutes: test.answerMinutes ?? DEFAULT_ANSWER_MINUTES,
        tutorMarks: test.tutorMarks,
      },
      attempts,
      attemptsLeft: attemptsLeft(test.maxAttempts, attempts.length),
      answersRevealed: reveal,
      bestAttempt,
      pendingAttempt,
      // Fingerspelling is played for the high score.
      ...(kind === "FINGERSPELLING" && { highScores: await highScores(id, session.sub) }),
    })
  } catch (err) {
    console.error("[GET /api/student/lessons/[id]/quiz]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
