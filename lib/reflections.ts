/**
 * Self-reflections (tests of kind REFLECTION): coursework the student writes,
 * one section per criterion, and sends back and forth with their teacher.
 *
 *   DRAFT ──send──▶ SUBMITTED ──send back with feedback──▶ RETURNED ──send──▶ SUBMITTED …
 *                           └──mark complete──▶ COMPLETE
 *
 * Only the criteria the teacher left unlocked can be written in, and every
 * one of them must have something in it before the document can be sent.
 * When it is complete, a QuizAttempt (100%, passed) is written and the lesson
 * ticked off, so course progress, "tests passed" and the reminders count it
 * like any other test.
 */
import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { createNotification } from "@/lib/notifications"
import { isStaff } from "@/lib/permissions"
import { REFLECTION_MAX_CHARS } from "@/lib/quiz"
import { isOwnAnswerVideo } from "@/lib/test-recordings"

export type Criterion = { id: string; question: string; locked: boolean; section: string | null }

/** The criteria of a test, in order. */
export function criteriaOf(testId: string): Promise<Criterion[]> {
  return prisma.quizQuestion.findMany({
    where: { testId },
    orderBy: { order: "asc" },
    select: { id: true, question: true, locked: true, section: true },
  })
}

/** A JSON column read back as criterion id → text, ignoring anything else in it. */
export function textMap(value: Prisma.JsonValue | unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
  )
}

/**
 * What a student sent, kept to the criteria they may write in and trimmed to
 * length. A locked criterion's text is never stored, whatever was sent.
 */
export function cleanAnswers(sent: unknown, criteria: Criterion[]): Record<string, string> {
  const given = textMap(sent)
  const out: Record<string, string> = {}
  for (const c of criteria) {
    if (c.locked) continue
    const text = given[c.id]
    if (typeof text === "string" && text.trim()) out[c.id] = text.slice(0, REFLECTION_MAX_CHARS)
  }
  return out
}

/** The open criteria with nothing written in them yet. */
export function missingCriteria(criteria: Criterion[], answers: Record<string, string>): Criterion[] {
  return criteria.filter((c) => !c.locked && !answers[c.id]?.trim())
}

/** Notes a teacher left on single criteria, kept to this test's criteria. */
export function cleanNotes(sent: unknown, criteria: Criterion[]): Record<string, string> {
  const given = textMap(sent)
  const out: Record<string, string> = {}
  for (const c of criteria) {
    const note = given[c.id]?.trim()
    if (note) out[c.id] = note.slice(0, 5000)
  }
  return out
}

/** Whether a URL sent as feedback is a recording in this student's folder for this lesson. */
export function isFeedbackVideo(url: unknown, lessonId: string, studentId: string): url is string {
  return isOwnAnswerVideo(url, lessonId, studentId)
}

/** The course's teachers: its owner and everyone teaching on it, with their roles. */
async function courseTeachers(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      title: true,
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
  })
  if (!lesson) return null
  const course = lesson.section.course
  const teachers = new Map([course.tutor, ...course.teachers.map((t) => t.tutor)].map((t) => [t.id, t.role]))
  return { lessonTitle: lesson.title, course, teachers }
}

/** A student has sent their self-reflection in: the course's teachers are told. */
export async function notifyReflectionSent(lessonId: string, studentName: string, again: boolean) {
  const found = await courseTeachers(lessonId)
  if (!found) return
  const { lessonTitle, course, teachers } = found
  await Promise.all([...teachers].map(([id, role]) => createNotification(
    id,
    "TEST_TO_MARK",
    `Self-reflection to read — ${lessonTitle}`,
    again
      ? `${studentName} has changed their self-reflection "${lessonTitle}" on ${course.title} and sent it back to you.`
      : `${studentName} has sent in their self-reflection "${lessonTitle}" on ${course.title}. Read it, then send it back with feedback or mark it complete.`,
    `${isStaff(role) ? "/admin" : "/tutor"}/courses/${course.id}/lessons/${lessonId}`,
  )))
}

/** The teacher has sent the self-reflection back, or accepted it: the student is told. */
export async function notifyReflectionReviewed(lessonId: string, studentId: string, outcome: "RETURNED" | "COMPLETE") {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { title: true } })
  if (!lesson) return
  const link = `/student/lessons/${lessonId}`
  if (outcome === "COMPLETE") {
    await createNotification(
      studentId,
      "QUIZ_PASSED",
      `Your self-reflection is complete — ${lesson.title}`,
      `Your teacher has marked "${lesson.title}" complete. Well done!`,
      link,
      "Self-reflection",
    )
  } else {
    await createNotification(
      studentId,
      "REFLECTION_RETURNED",
      `Feedback on your self-reflection — ${lesson.title}`,
      `Your teacher has sent "${lesson.title}" back with feedback. Read it, make your changes and send it again.`,
      link,
    )
  }
}

/**
 * Ticks the lesson off for the student and records a passed attempt, so the
 * places that count tests passed count this one too.
 */
export async function recordReflectionComplete(lessonId: string, studentId: string) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { section: { select: { courseId: true } } } })
  if (!lesson) return
  const passed = await prisma.quizAttempt.findFirst({ where: { lessonId, userId: studentId, passed: true }, select: { id: true } })
  if (!passed) {
    await prisma.quizAttempt.create({ data: { lessonId, userId: studentId, score: 100, passed: true, selfMarked: true } })
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, courseId: lesson.section.courseId },
    select: { id: true },
  })
  if (enrollment) {
    await prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
      create: { enrollmentId: enrollment.id, lessonId, isCompleted: true, completedAt: new Date() },
      update: { isCompleted: true, completedAt: new Date() },
    })
  }
}
