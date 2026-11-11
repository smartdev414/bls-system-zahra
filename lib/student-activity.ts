import prisma from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { isStaff, courseTeachScope } from "@/lib/permissions"
import { joinedClassOf } from "@/lib/session-access"
import { releasedLessons } from "@/lib/lesson-release"

// What students have actually *done* — lessons, tests, live classes, league
// games, self-reflections — as opposed to merely being signed in. Read from the
// records those already leave behind, so nothing new has to be written while a
// student learns.

export type LearningKind = "lesson" | "lesson-completed" | "test" | "class" | "league" | "reflection"

export type LearningCounts = Record<LearningKind, number>

const emptyCounts = (): LearningCounts => ({
  lesson: 0, "lesson-completed": 0, test: 0, class: 0, league: 0, reflection: 0,
})

// Every learning event as (uid, at, kind). Lesson progress on tests is left
// out: a teacher marking or resetting a test touches that row, which is not the
// student studying — their attempts are counted as "test" instead.
const eventsSql = (ids: string[]) => Prisma.sql`
  SELECT e."studentId" AS uid, lp."updatedAt" AS at, 'lesson' AS kind
    FROM "LessonProgress" lp
    JOIN "Enrollment" e ON e."id" = lp."enrollmentId"
    JOIN "Lesson" l ON l."id" = lp."lessonId"
   WHERE e."studentId" = ANY(${ids}) AND l."type" <> 'QUIZ'
  UNION ALL
  SELECT e."studentId", lp."completedAt", 'lesson-completed'
    FROM "LessonProgress" lp
    JOIN "Enrollment" e ON e."id" = lp."enrollmentId"
    JOIN "Lesson" l ON l."id" = lp."lessonId"
   WHERE e."studentId" = ANY(${ids}) AND l."type" <> 'QUIZ' AND lp."completedAt" IS NOT NULL
  UNION ALL
  SELECT "userId", "createdAt", 'test' FROM "QuizAttempt" WHERE "userId" = ANY(${ids})
  UNION ALL
  SELECT "studentId", "joinedAt", 'class' FROM "LiveSessionAttendance"
   WHERE "studentId" = ANY(${ids}) AND "joinedAt" IS NOT NULL
  UNION ALL
  SELECT "userId", "createdAt", 'league' FROM "LeagueAttempt" WHERE "userId" = ANY(${ids})
  UNION ALL
  SELECT "userId", COALESCE("submittedAt", "updatedAt"), 'reflection' FROM "ReflectionSubmission"
   WHERE "userId" = ANY(${ids})
`

const UK_DAY = Prisma.sql`to_char((ev.at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')`

export type LearningSummary = {
  lastStudiedAt: Date | null
  /** UK dates ("YYYY-MM-DD", newest first) with any learning in the window. */
  studyDates: string[]
  /** Totals in the window. */
  counts: LearningCounts
}

/** For each student: when they last studied, and what they did in the last `days` days. */
export async function learningSummary(userIds: string[], days = 30): Promise<Map<string, LearningSummary>> {
  const result = new Map<string, LearningSummary>(
    userIds.map((id) => [id, { lastStudiedAt: null, studyDates: [], counts: emptyCounts() }]),
  )
  if (userIds.length === 0) return result
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [last, perDay] = await Promise.all([
    prisma.$queryRaw<Array<{ uid: string; last: Date }>>`
      SELECT ev.uid, MAX(ev.at) AS last FROM (${eventsSql(userIds)}) ev GROUP BY ev.uid`,
    prisma.$queryRaw<Array<{ uid: string; day: string; kind: LearningKind; n: number }>>`
      SELECT ev.uid, ${UK_DAY} AS day, ev.kind, COUNT(*)::int AS n
        FROM (${eventsSql(userIds)}) ev
       WHERE ev.at >= ${since}
       GROUP BY 1, 2, 3
       ORDER BY 2 DESC`,
  ])
  for (const l of last) {
    const r = result.get(l.uid)
    if (r) r.lastStudiedAt = l.last
  }
  for (const d of perDay) {
    const r = result.get(d.uid)
    if (!r) continue
    r.counts[d.kind] += d.n
    if (r.studyDates[r.studyDates.length - 1] !== d.day) r.studyDates.push(d.day)
  }
  return result
}

/** Learning per UK day for one student: `{ "2026-11-10": { lesson: 2, test: 1, … } }`. */
export async function learningByDay(userId: string, since: Date): Promise<Map<string, Partial<LearningCounts>>> {
  const rows = await prisma.$queryRaw<Array<{ day: string; kind: LearningKind; n: number }>>`
    SELECT ${UK_DAY} AS day, ev.kind, COUNT(*)::int AS n
      FROM (${eventsSql([userId])}) ev
     WHERE ev.at >= ${since}
     GROUP BY 1, 2`
  const result = new Map<string, Partial<LearningCounts>>()
  for (const r of rows) {
    const day = result.get(r.day) ?? {}
    day[r.kind] = (day[r.kind] ?? 0) + r.n
    result.set(r.day, day)
  }
  return result
}

/** UK days one student was on the platform at all (API log + sign-ins). */
export async function activeDays(userId: string, since: Date): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ day: string }>>`
    SELECT DISTINCT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day
      FROM (
        SELECT "createdAt" FROM "ApiLog" WHERE "userId" = ${userId} AND "createdAt" >= ${since}
        UNION ALL
        SELECT "createdAt" FROM "LoginEvent" WHERE "userId" = ${userId} AND "success" AND "createdAt" >= ${since}
      ) x`
  return new Set(rows.map((r) => r.day))
}

export type TimelineItem = {
  at: string
  kind: LearningKind | "login"
  title: string
  detail: string | null
  href?: string
}

/** The student's most recent learning, newest first, with what each thing was. */
export async function learningTimeline(userId: string, limit = 60): Promise<TimelineItem[]> {
  const [lessons, attempts, classes, leagues, reflections] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { enrollment: { studentId: userId }, lesson: { type: { not: "QUIZ" } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        updatedAt: true, isCompleted: true, completedAt: true, watchedSecs: true,
        lesson: { select: { title: true, section: { select: { course: { select: { title: true } } } } } },
      },
    }),
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        createdAt: true, score: true, passed: true, selfMarked: true,
        lesson: { select: { title: true, section: { select: { course: { select: { title: true } } } } } },
      },
    }),
    prisma.liveSessionAttendance.findMany({
      where: { studentId: userId, joinedAt: { not: null } },
      orderBy: { joinedAt: "desc" },
      take: limit,
      select: { joinedAt: true, leftAt: true, session: { select: { title: true } } },
    }),
    prisma.leagueAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { createdAt: true, correct: true, total: true, league: { select: { title: true } } },
    }),
    prisma.reflectionSubmission.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        updatedAt: true, submittedAt: true, status: true,
        lesson: { select: { title: true, section: { select: { course: { select: { title: true } } } } } },
      },
    }),
  ])

  const items: TimelineItem[] = []
  for (const p of lessons) {
    const mins = Math.round(p.watchedSecs / 60)
    items.push({
      at: (p.completedAt && p.isCompleted ? p.completedAt : p.updatedAt).toISOString(),
      kind: p.isCompleted ? "lesson-completed" : "lesson",
      title: p.lesson.title,
      detail: [p.lesson.section.course.title, p.isCompleted ? "Completed" : "Worked on", mins > 0 ? `${mins} min watched` : null]
        .filter(Boolean).join(" · "),
    })
  }
  for (const a of attempts) {
    items.push({
      at: a.createdAt.toISOString(),
      kind: "test",
      title: a.lesson.title,
      detail: [a.lesson.section.course.title, !a.selfMarked ? "Waiting to be marked" : `${a.score}% · ${a.passed ? "passed" : "not passed"}`].join(" · "),
    })
  }
  for (const c of classes) {
    const mins = c.leftAt && c.joinedAt ? Math.round((c.leftAt.getTime() - c.joinedAt.getTime()) / 60000) : null
    items.push({
      at: c.joinedAt!.toISOString(),
      kind: "class",
      title: c.session.title,
      detail: mins !== null && mins > 0 ? `Live class · ${mins} min` : "Live class",
    })
  }
  for (const l of leagues) {
    items.push({
      at: l.createdAt.toISOString(),
      kind: "league",
      title: l.league.title,
      detail: `League game · ${l.correct}/${l.total} correct`,
    })
  }
  for (const r of reflections) {
    items.push({
      at: (r.submittedAt ?? r.updatedAt).toISOString(),
      kind: "reflection",
      title: r.lesson.title,
      detail: `${r.lesson.section.course.title} · Self-reflection ${r.status.toLowerCase().replace(/_/g, " ")}`,
    })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/** Each course the student is on, and how far through the released lessons they are. */
export async function courseProgress(userId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: userId },
    orderBy: { enrolledAt: "desc" },
    select: {
      enrolledAt: true,
      course: { select: { id: true, title: true } },
      progress: { where: { isCompleted: true }, select: { id: true } },
    },
  })
  return Promise.all(
    enrollments.map(async (e) => {
      const total = await prisma.lesson.count({ where: { section: { courseId: e.course.id }, ...releasedLessons() } })
      const done = Math.min(e.progress.length, total)
      return {
        id: e.course.id,
        title: e.course.title,
        enrolledAt: e.enrolledAt.toISOString(),
        totalLessons: total,
        completedLessons: done,
        completion: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    }),
  )
}

/**
 * Whether this staff member or tutor may look at this student's activity:
 * staff see every student; a tutor sees students on a course they teach, ones
 * they invited, and ones who joined one of their classes — the same people as
 * their student list.
 */
export async function canViewStudent(session: { role: string; sub: string }, studentId: string): Promise<boolean> {
  if (isStaff(session.role)) {
    return (await prisma.user.count({ where: { id: studentId, role: "STUDENT" } })) > 0
  }
  if (session.role !== "TUTOR") return false
  const found = await prisma.user.count({
    where: {
      id: studentId,
      role: "STUDENT",
      OR: [
        { enrollments: { some: { course: courseTeachScope(session) } } },
        { invitedById: session.sub },
        joinedClassOf(session.sub),
      ],
    },
  })
  return found > 0
}
