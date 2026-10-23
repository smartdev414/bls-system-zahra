/**
 * Re-working out an attempt's score once marks change — when the student marks
 * their written and signed answers, and when a teacher changes a mark. Kept in
 * one place so both arrive at the same score, pass and lesson progress.
 */
import prisma from "@/lib/prisma"
import { attemptScore, awaitsMarks } from "@/lib/quiz"

/**
 * Recalculates the attempt from its answers as stored now, saves the score and
 * whether it passed, and ticks the lesson off (or back on to do, when a
 * teacher's change means no attempt passes any more).
 */
export async function rescoreAttempt(attemptId: string) {
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      id: true, userId: true, lessonId: true, passed: true,
      lesson: { select: { section: { select: { courseId: true } }, test: { select: { passMark: true, testKind: true, vocabularyMode: true } } } },
      answers: { select: { questionId: true, isCorrect: true, marks: true, question: { select: { id: true, type: true, maxMarks: true } } } },
    },
  })

  const questions = attempt.answers.map((a) => a.question)
  // Deleting a test deletes its questions, and these answers with them: the
  // test is always here. The fallback only satisfies the types.
  const test = attempt.lesson.test ?? { passMark: 100, testKind: "STANDARD", vocabularyMode: null }
  const { earned, total, score } = attemptScore(questions, attempt.answers, test)
  // Still waiting on the student: it cannot pass until every mark is in.
  const selfMarked = attempt.answers.every((a) => !awaitsMarks(a.question, a, test))
  const passed = selfMarked && score >= test.passMark

  await prisma.quizAttempt.update({ where: { id: attemptId }, data: { score, passed, selfMarked } })

  if (passed !== attempt.passed) {
    const where = { lessonId: attempt.lessonId, enrollment: { studentId: attempt.userId, courseId: attempt.lesson.section.courseId } }
    if (passed) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { studentId: attempt.userId, courseId: attempt.lesson.section.courseId },
        select: { id: true },
      })
      if (enrollment) {
        await prisma.lessonProgress.upsert({
          where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: attempt.lessonId } },
          create: { enrollmentId: enrollment.id, lessonId: attempt.lessonId, isCompleted: true, completedAt: new Date() },
          update: { isCompleted: true, completedAt: new Date() },
        })
      }
    } else {
      const otherPass = await prisma.quizAttempt.findFirst({
        where: { lessonId: attempt.lessonId, userId: attempt.userId, passed: true, id: { not: attemptId } },
        select: { id: true },
      })
      if (!otherPass) await prisma.lessonProgress.updateMany({ where, data: { isCompleted: false, completedAt: null } })
    }
  }

  return { score, passed, selfMarked, earned, total }
}
