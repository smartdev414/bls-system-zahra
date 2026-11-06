/**
 * Trophies — a pat on the back for a student's hard work on a course.
 *
 * They go out on their own: the moment a student has done every lesson and
 * test released on a course so far, they get a trophy (bell, email, phone) and
 * see it on their dashboard. When more lessons or tests are released and they
 * finish those too, they get another. A teacher can also give one by hand from
 * the course's student list, to anyone who has earned it.
 */
import prisma from "@/lib/prisma"
import { createNotifications } from "@/lib/notifications"
import { courseRoster, TROPHY_COOLDOWN_HOURS } from "@/lib/course-roster"

/** Where a trophy notification takes the student: their dashboard's trophy shelf. */
export const TROPHY_LINK = "/student#trophies"

/**
 * Gives the students a trophy on the course, and tells them. Anyone who got one
 * for this course in the last few hours is skipped, so a double click or two
 * teachers at once never sends two. `givenBy` is null for the automatic one.
 */
export async function giveTrophies(
  course: { id: string; title: string },
  students: Array<{ id: string; done: number }>,
  givenBy: { id: string; name: string } | null,
): Promise<{ given: number; skipped: number }> {
  if (students.length === 0) return { given: 0, skipped: 0 }
  const recent = await prisma.trophy.findMany({
    where: {
      courseId: course.id,
      studentId: { in: students.map((s) => s.id) },
      createdAt: { gte: new Date(Date.now() - TROPHY_COOLDOWN_HOURS * 60 * 60 * 1000) },
    },
    select: { studentId: true },
  })
  const skip = new Set(recent.map((t) => t.studentId))
  const toGive = students.filter((s) => !skip.has(s.id))
  if (toGive.length === 0) return { given: 0, skipped: skip.size }

  await prisma.trophy.createMany({
    data: toGive.map((s) => ({ studentId: s.id, courseId: course.id, givenById: givenBy?.id ?? null, workDone: s.done })),
  })
  await createNotifications(
    toGive.map((s) => s.id),
    "TROPHY",
    `You've earned a trophy for ${course.title}!`,
    givenBy
      ? `${givenBy.name} has given you a trophy for your hard work on "${course.title}". Well done — keep it up!`
      : `You have finished every lesson and test on "${course.title}" so far. Brilliant work — well done, and keep it up!`,
    TROPHY_LINK,
  )
  return { given: toGive.length, skipped: skip.size }
}

/** Gives the automatic trophy to everyone on the course who has just earned it. */
export async function awardFinishers(courseId: string): Promise<number> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, status: true } })
  if (!course || course.status !== "PUBLISHED") return 0
  const roster = await courseRoster(courseId)
  const due = roster.students.filter((s) => s.trophyDue)
  return (await giveTrophies(course, due, null)).given
}

/**
 * The same for one student, right after they finish a lesson or a test — so the
 * trophy arrives while they are still on the platform. Never throws: a trophy
 * must not get in the way of saving their work.
 */
export async function awardIfFinished(studentId: string, courseId: string): Promise<void> {
  try {
    const roster = await courseRoster(courseId)
    const me = roster.students.find((s) => s.id === studentId)
    if (!me?.trophyDue) return
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, status: true } })
    if (course?.status === "PUBLISHED") await giveTrophies(course, [me], null)
  } catch (err) {
    console.error(`[trophies] could not check ${studentId} on ${courseId}`, err)
  }
}

/** The course a lesson belongs to, for `awardIfFinished` after a test. */
export async function courseOfLesson(lessonId: string): Promise<string | null> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { section: { select: { courseId: true } } } })
  return lesson?.section.courseId ?? null
}
