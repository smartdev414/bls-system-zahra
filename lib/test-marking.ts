/**
 * Re-working out an attempt's score once marks change — when the student marks
 * their written and signed answers, and when a teacher changes a mark. Kept in
 * one place so both arrive at the same score, pass and lesson progress.
 */
import prisma from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { isStaff } from "@/lib/permissions"
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

/**
 * An assessment a teacher marks has been sent in: the course's teachers are
 * told, with a link to its results, where they mark it.
 */
export async function notifyTeachersToMark(attemptId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      lessonId: true,
      user: { select: { name: true } },
      lesson: {
        select: {
          title: true,
          test: { select: { testKind: true } },
          section: {
            select: {
              course: {
                select: {
                  id: true, title: true,
                  tutor: { select: { id: true, role: true } },
                  teachers: { select: { tutor: { select: { id: true, role: true } } } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!attempt) return
  const course = attempt.lesson.section.course
  const teachers = new Map([course.tutor, ...course.teachers.map((t) => t.tutor)].map((t) => [t.id, t.role]))
  await Promise.all([...teachers].map(([id, role]) => createNotification(
    id,
    "TEST_TO_MARK",
    `Answers to mark — ${attempt.lesson.title}`,
    attempt.lesson.test?.testKind === "PRESENTATION"
      ? `${attempt.user.name} has sent in their presentation for "${attempt.lesson.title}" on ${course.title}. Watch it, mark it, and record your feedback if you like.`
      : `${attempt.user.name} has sent in their answers to "${attempt.lesson.title}" on ${course.title}. Watch their videos and mark them.`,
    `${isStaff(role) ? "/admin" : "/tutor"}/courses/${course.id}/lessons/${attempt.lessonId}`,
  )))
}

/** A teacher has finished marking an assessment: the student hears how it went. */
export async function notifyStudentMarked(attemptId: string) {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      userId: true, lessonId: true, score: true, passed: true,
      lesson: { select: { title: true, test: { select: { testKind: true } } } },
    },
  })
  if (!attempt) return
  const seeWhat = attempt.lesson.test?.testKind === "PRESENTATION" ? "your marks and your teacher's feedback" : "your marks and the answer sheet"
  await createNotification(
    attempt.userId,
    attempt.passed ? "QUIZ_PASSED" : "QUIZ_FAILED",
    `Your teacher has marked "${attempt.lesson.title}" — ${attempt.score}%`,
    attempt.passed
      ? `You passed. See ${seeWhat}.`
      : `Not passed this time. See ${seeWhat}.`,
    `/student/lessons/${attempt.lessonId}`,
  )
}
