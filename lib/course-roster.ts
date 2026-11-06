/**
 * The students on one course and how each is doing against the rest of the
 * class — shared by the course's student list, the reminder button and the
 * trophy button, so all three agree on who is ahead, who is behind and who has
 * finished.
 *
 * Progress is measured against what has been released so far: a lesson or test
 * scheduled for next week is not homework yet. A test counts as done once the
 * student has sat it or sent it in (see lib/test-progress), the same rule the
 * Students page and the automatic test reminder use.
 */
import prisma from "@/lib/prisma"
import { releasedLessons } from "@/lib/lesson-release"
import { BEHIND_AFTER_DAYS, reminderLink } from "@/lib/homework"
import { statusOf, testStatuses, UNFINISHED } from "@/lib/test-progress"

/** How far below the class average (in percentage points) counts as behind the class. */
export const BEHIND_CLASS_POINTS = 15

/** One student is not given a second trophy for the same course within this window. */
export const TROPHY_COOLDOWN_HOURS = 20

export type RosterStudent = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  bslLevel: string | null
  enrolledAt: string
  completedLessons: number
  /** Released tests sat or sent in. */
  testsDone: number
  /** Lessons and tests done, out of everything released: 0–100. */
  percent: number
  /** Position in the class by `percent`, 1 = furthest ahead; equal progress shares a place. */
  rank: number
  /** Every released lesson and test done. */
  allDone: boolean
  lastActiveAt: string | null
  /** Work outstanding and nothing done for a week (or since joining a week or more ago). */
  inactive: boolean
  /** Well below the class average, and on the course long enough to have caught up. */
  behindClass: boolean
  /** Either of the two: someone a reminder is meant for. */
  behind: boolean
  lastRemindedAt: string | null
  reminderCount: number
  trophies: number
  lastTrophyAt: string | null
  /** Lessons and tests done. */
  done: number
  /** Everything released is done, and more than at their last trophy: an automatic trophy is due. */
  trophyDue: boolean
}

export type Roster = {
  totalLessons: number
  totalTests: number
  totalWork: number
  /** The class's average `percent`. */
  classAverage: number
  students: RosterStudent[]
  total: number
}

export async function courseRoster(courseId: string, now: Date = new Date()): Promise<Roster> {
  const [enrolments, lessons] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId },
      orderBy: { student: { name: "asc" } },
      include: {
        student: { select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true } },
        progress: { select: { lessonId: true, isCompleted: true, updatedAt: true } },
      },
    }),
    prisma.lesson.findMany({
      where: { section: { courseId }, ...releasedLessons(now) },
      select: { id: true, type: true, testId: true },
    }),
  ])

  // Tests are counted once, as tests (done once sat or sent in) — not again as
  // lessons, which they only become on a pass. Only quizzes with a test behind
  // them are tests (the same list lib/test-progress uses).
  const isTest = (l: (typeof lessons)[number]) => l.type === "QUIZ" && !!l.testId
  const lessonIds = new Set(lessons.filter((l) => !isTest(l)).map((l) => l.id))
  const testIds = lessons.filter(isTest).map((l) => l.id)
  const studentIds = enrolments.map((e) => e.studentId)
  const any = studentIds.length > 0

  const [statuses, attempts, reminders, trophies] = await Promise.all([
    testStatuses(testIds, studentIds),
    testIds.length > 0 && any
      ? prisma.quizAttempt.findMany({
          where: { lessonId: { in: testIds }, userId: { in: studentIds } },
          select: { userId: true, createdAt: true },
        })
      : [],
    // The reminder history is the notifications themselves.
    any
      ? prisma.notification.groupBy({
          by: ["userId"],
          where: { type: "HOMEWORK_REMINDER", link: reminderLink(courseId), userId: { in: studentIds } },
          _max: { createdAt: true },
          _count: { _all: true },
        })
      : [],
    any
      ? prisma.trophy.groupBy({
          by: ["studentId"],
          where: { courseId, studentId: { in: studentIds } },
          _max: { createdAt: true, workDone: true },
          _count: { _all: true },
        })
      : [],
  ])
  const remindedAt = new Map(reminders.map((r) => [r.userId, { last: r._max.createdAt, count: r._count._all }]))
  const trophiesOf = new Map(trophies.map((t) => [
    t.studentId,
    { last: t._max.createdAt, count: t._count._all, workDone: t._max.workDone ?? 0 },
  ]))
  const lastAttempt = new Map<string, number>()
  for (const a of attempts) lastAttempt.set(a.userId, Math.max(lastAttempt.get(a.userId) ?? 0, a.createdAt.getTime()))

  const totalWork = lessonIds.size + testIds.length
  const settledBefore = now.getTime() - BEHIND_AFTER_DAYS * 24 * 60 * 60 * 1000

  const students = enrolments.map((e) => {
    const completedLessons = e.progress.filter((p) => p.isCompleted && lessonIds.has(p.lessonId)).length
    const testsDone = testIds.filter((t) => !UNFINISHED.has(statusOf(statuses, e.studentId, t).status)).length
    const done = completedLessons + testsDone
    const lastActive = Math.max(0, ...e.progress.map((p) => p.updatedAt.getTime()), lastAttempt.get(e.studentId) ?? 0)
    const allDone = totalWork > 0 && done >= totalWork
    const reminder = remindedAt.get(e.studentId)
    const trophy = trophiesOf.get(e.studentId)
    return {
      ...e.student,
      enrolledAt: e.enrolledAt.toISOString(),
      completedLessons,
      testsDone,
      done,
      percent: totalWork > 0 ? Math.round((done / totalWork) * 100) : 0,
      rank: 0,
      allDone,
      lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
      // Someone who only joined this week has not had the chance to fall behind.
      inactive: totalWork > 0 && !allDone && Math.max(lastActive, e.enrolledAt.getTime()) < settledBefore,
      behindClass: false,
      behind: false,
      lastRemindedAt: reminder?.last?.toISOString() ?? null,
      reminderCount: reminder?.count ?? 0,
      trophies: trophy?.count ?? 0,
      lastTrophyAt: trophy?.last?.toISOString() ?? null,
      /** Finished more than they had when they last got a trophy: one is due. */
      trophyDue: allDone && done > (trophy?.workDone ?? 0),
      settled: e.enrolledAt.getTime() < settledBefore,
    }
  })

  const classAverage = students.length > 0
    ? Math.round(students.reduce((sum, s) => sum + s.percent, 0) / students.length)
    : 0
  for (const s of students) {
    s.rank = 1 + students.filter((o) => o.percent > s.percent).length
    s.behindClass = students.length >= 2 && totalWork > 0 && s.settled && !s.allDone &&
      s.percent <= classAverage - BEHIND_CLASS_POINTS
    s.behind = s.inactive || s.behindClass
  }

  return {
    totalLessons: lessonIds.size,
    totalWork,
    totalTests: testIds.length,
    classAverage,
    students: students.map(({ settled: _settled, ...s }) => s),
    total: students.length,
  }
}
