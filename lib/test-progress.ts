/**
 * Who has done which test on a course — shared by the teachers' "Test
 * progress" grid and the automatic reminder that chases unfinished tests, so
 * both agree on what "finished" means.
 *
 * A test is finished, as far as the student is concerned, once they have sat
 * it (even without passing — their teacher decides about a retake), or sent it
 * in for their teacher to mark. It is not finished while it is untouched, while
 * their own written or signed answers still wait for them to mark, or while a
 * self-reflection is still being written or has been sent back to them.
 */
import prisma from "@/lib/prisma"
import { releasedLessons } from "@/lib/lesson-release"

export type TestStatus =
  | "PASSED"        // passed, or a self-reflection accepted
  | "WITH_TEACHER"  // sent in, waiting for the teacher to mark it
  | "NOT_PASSED"    // sat and marked, but not passed
  | "TO_MARK"       // sat, but the student has not marked their own answers yet
  | "STARTED"       // self-reflection being written
  | "RETURNED"      // self-reflection sent back to the student with feedback
  | "NOT_STARTED"

/** Statuses that still need something from the student. */
export const UNFINISHED: ReadonlySet<TestStatus> = new Set(["NOT_STARTED", "STARTED", "RETURNED", "TO_MARK"])

export type CourseTest = { id: string; title: string; releaseAt: Date | null }

export type TestCell = { status: TestStatus; score: number | null; attempts: number }

/** Each course's released tests, in course order: `result.get(courseId)`. */
export async function courseTests(courseIds: string[], now: Date = new Date()): Promise<Map<string, CourseTest[]>> {
  const result = new Map<string, CourseTest[]>(courseIds.map((id) => [id, []]))
  if (courseIds.length === 0) return result
  const lessons = await prisma.lesson.findMany({
    where: { section: { courseId: { in: courseIds } }, type: "QUIZ", testId: { not: null }, ...releasedLessons(now) },
    orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
    select: { id: true, title: true, releaseAt: true, section: { select: { courseId: true } } },
  })
  for (const { section, ...test } of lessons) result.get(section.courseId)?.push(test)
  return result
}

/**
 * When each user was last on the platform, and the days (UK dates,
 * "YYYY-MM-DD", newest first) they used it in the last `days` days — read from
 * the API log, which records every signed-in request.
 */
export async function activity(
  userIds: string[],
  days = 30,
): Promise<Map<string, { lastSeenAt: Date | null; activeDates: string[] }>> {
  const result = new Map<string, { lastSeenAt: Date | null; activeDates: string[] }>(
    userIds.map((id) => [id, { lastSeenAt: null, activeDates: [] }]),
  )
  if (userIds.length === 0) return result
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const [last, dates] = await Promise.all([
    prisma.apiLog.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _max: { createdAt: true } }),
    prisma.$queryRaw<Array<{ userId: string; day: string }>>`
      SELECT "userId", to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day
      FROM "ApiLog"
      WHERE "userId" = ANY(${userIds}) AND "createdAt" >= ${since}
      GROUP BY 1, 2
      ORDER BY 2 DESC`,
  ])
  for (const l of last) if (l.userId) result.get(l.userId)!.lastSeenAt = l._max.createdAt
  for (const d of dates) result.get(d.userId)?.activeDates.push(d.day)
  return result
}

/**
 * Each student's status on each test: `result.get(studentId).get(lessonId)`.
 * Students with nothing on a test simply have no entry for it (= NOT_STARTED).
 */
export async function testStatuses(
  lessonIds: string[],
  studentIds: string[],
): Promise<Map<string, Map<string, TestCell>>> {
  const result = new Map<string, Map<string, TestCell>>()
  if (lessonIds.length === 0 || studentIds.length === 0) return result

  const [attempts, reflections, tutorMarked] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { lessonId: { in: lessonIds }, userId: { in: studentIds } },
      select: { userId: true, lessonId: true, score: true, passed: true, selfMarked: true },
    }),
    prisma.reflectionSubmission.findMany({
      where: { lessonId: { in: lessonIds }, userId: { in: studentIds } },
      select: { userId: true, lessonId: true, status: true },
    }),
    prisma.lesson.findMany({
      where: { id: { in: lessonIds }, test: { tutorMarks: true } },
      select: { id: true },
    }),
  ])
  const teacherMarks = new Set(tutorMarked.map((l) => l.id))

  const cell = (studentId: string, lessonId: string): TestCell => {
    let mine = result.get(studentId)
    if (!mine) result.set(studentId, (mine = new Map()))
    let c = mine.get(lessonId)
    if (!c) mine.set(lessonId, (c = { status: "NOT_STARTED", score: null, attempts: 0 }))
    return c
  }

  // Strongest first: once passed, nothing else matters.
  const rank: Record<TestStatus, number> = {
    PASSED: 6, WITH_TEACHER: 5, NOT_PASSED: 4, TO_MARK: 3, RETURNED: 2, STARTED: 1, NOT_STARTED: 0,
  }
  const raise = (c: TestCell, status: TestStatus) => {
    if (rank[status] > rank[c.status]) c.status = status
  }

  for (const a of attempts) {
    const c = cell(a.userId, a.lessonId)
    c.attempts++
    // An attempt waiting for marks is stored with a score of 0: not a real score.
    if (a.selfMarked) c.score = Math.max(c.score ?? 0, a.score)
    raise(c, a.passed ? "PASSED" : !a.selfMarked ? (teacherMarks.has(a.lessonId) ? "WITH_TEACHER" : "TO_MARK") : "NOT_PASSED")
  }
  for (const r of reflections) {
    const c = cell(r.userId, r.lessonId)
    raise(c, r.status === "COMPLETE" ? "PASSED" : r.status === "SUBMITTED" ? "WITH_TEACHER" : r.status === "RETURNED" ? "RETURNED" : "STARTED")
  }
  return result
}

export function statusOf(map: Map<string, Map<string, TestCell>>, studentId: string, lessonId: string): TestCell {
  return map.get(studentId)?.get(lessonId) ?? { status: "NOT_STARTED", score: null, attempts: 0 }
}
