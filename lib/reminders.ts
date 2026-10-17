/**
 * Automatic reminders — run every few minutes by GET /api/cron/reminders.
 *
 *   • A class tomorrow     — the day before (any time from 24h to 2h ahead)
 *   • A class very soon    — within the hour before it starts
 *   • Lessons unlocked     — when lessons held back for a release date open
 *   • Behind on homework   — work outstanding and nothing done for a week;
 *                            at most once a week per course, counting the
 *                            reminders tutors send by hand
 *
 * Each goes out through createNotification(s), so it lands in the bell, by
 * email and on the student's phone. Every reminder is first claimed in
 * `ReminderSent` under a key naming what it is about; a run that repeats or
 * overlaps another finds the key taken and sends nothing.
 */
import prisma from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { BEHIND_AFTER_DAYS, reminderLink } from "@/lib/homework"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Classes are timetabled in UK time; the server runs in UTC.
const TIME_ZONE = "Europe/London"

const timeLabel = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE })
const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE })

/** Claims a reminder; false when it was already sent (by this run or another). */
async function claim(key: string): Promise<boolean> {
  try {
    await prisma.reminderSent.create({ data: { key } })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false
    throw err
  }
}

/**
 * The students a class is for: invited, let in on request, or — for a
 * whole-course class — everyone on the course. Open sessions anyone may drop
 * into remind nobody in particular.
 */
async function classStudents(s: { id: string; visibility: string; courseId: string | null }): Promise<string[]> {
  const [invites, approved, enrolled] = await Promise.all([
    prisma.liveSessionInvite.findMany({ where: { sessionId: s.id }, select: { studentId: true } }),
    prisma.sessionJoinRequest.findMany({ where: { sessionId: s.id, status: "APPROVED" }, select: { studentId: true } }),
    s.visibility === "PUBLIC" && s.courseId
      ? prisma.enrollment.findMany({ where: { courseId: s.courseId }, select: { studentId: true } })
      : [],
  ])
  return [...new Set([...invites, ...approved, ...enrolled].map((r) => r.studentId))]
}

async function classReminders(now: Date): Promise<number> {
  const upcoming = await prisma.liveSession.findMany({
    where: { status: "SCHEDULED", scheduledAt: { gt: now, lte: new Date(now.getTime() + DAY) } },
    select: { id: true, title: true, scheduledAt: true, visibility: true, courseId: true, inPerson: true, venue: true, tutor: { select: { name: true } } },
  })

  let sent = 0
  for (const s of upcoming) {
    const until = s.scheduledAt.getTime() - now.getTime()
    // The day-before nudge only makes sense while there is still a day to
    // plan around; inside the last two hours the "starting soon" one takes over.
    const kind = until <= HOUR ? "soon" : until > 2 * HOUR ? "day" : null
    if (!kind) continue

    const link = `/student/classroom/${s.id}`
    const tomorrow = dayLabel(new Date(now.getTime() + DAY)) === dayLabel(s.scheduledAt)
    const title = kind === "soon"
      ? `Starting soon: ${s.title}`
      : `${tomorrow ? "Tomorrow" : "Coming up"}: ${s.title}`
    // A face-to-face class says where to go, not to check a camera.
    const where = s.inPerson ? ` Face to face${s.venue ? ` at ${s.venue}` : ""}.` : ""
    const body = kind === "soon"
      ? s.inPerson
        ? `Your class with ${s.tutor.name} starts at ${timeLabel(s.scheduledAt)}.${where}`
        : `Your class with ${s.tutor.name} starts at ${timeLabel(s.scheduledAt)}. Join a few minutes early to check your camera.`
      : `Your class with ${s.tutor.name} is on ${dayLabel(s.scheduledAt)} at ${timeLabel(s.scheduledAt)}.${where}`

    for (const studentId of await classStudents(s)) {
      if (!(await claim(`class-${kind}:${s.id}:${studentId}`))) continue
      if (await createNotification(studentId, "SESSION_REMINDER", title, body, link)) sent++
    }
  }
  return sent
}

async function unlockReminders(now: Date): Promise<number> {
  // Only lessons that opened recently: the first run must not announce every
  // lesson that unlocked before reminders existed.
  const opened = await prisma.lesson.findMany({
    where: {
      releaseAt: { lte: now, gt: new Date(now.getTime() - 2 * DAY) },
      section: { course: { status: "PUBLISHED" } },
    },
    orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      section: { select: { course: { select: { id: true, title: true, enrollments: { select: { studentId: true } } } } } },
    },
  })

  // One message per student per course, however many lessons opened at once.
  const byStudentCourse = new Map<string, { studentId: string; course: { id: string; title: string }; lessons: { id: string; title: string }[] }>()
  for (const lesson of opened) {
    const course = lesson.section.course
    for (const { studentId } of course.enrollments) {
      if (!(await claim(`unlock:${lesson.id}:${studentId}`))) continue
      const k = `${studentId}:${course.id}`
      const entry = byStudentCourse.get(k) ?? { studentId, course, lessons: [] }
      entry.lessons.push({ id: lesson.id, title: lesson.title })
      byStudentCourse.set(k, entry)
    }
  }

  let sent = 0
  for (const { studentId, course, lessons } of byStudentCourse.values()) {
    const title = lessons.length === 1 ? `New lesson: ${lessons[0].title}` : `${lessons.length} new lessons in ${course.title}`
    const body = lessons.length === 1
      ? `"${lessons[0].title}" is now open on ${course.title}.`
      : `Now open: ${lessons.map((l) => l.title).join(", ")}.`
    const link = lessons.length === 1 ? `/student/lessons/${lessons[0].id}` : reminderLink(course.id)
    if (await createNotification(studentId, "LESSONS_UNLOCKED", title, body, link)) sent++
  }
  return sent
}

async function homeworkReminders(now: Date): Promise<number> {
  const quietSince = new Date(now.getTime() - BEHIND_AFTER_DAYS * DAY)

  const courses = await prisma.course.findMany({
    where: { status: "PUBLISHED", enrollments: { some: {} } },
    select: {
      id: true,
      title: true,
      sections: {
        select: {
          lessons: {
            where: { OR: [{ releaseAt: null }, { releaseAt: { lte: now } }] },
            select: { id: true, type: true },
          },
        },
      },
      enrollments: {
        // Joined this week: not had the chance to fall behind yet.
        where: { enrolledAt: { lt: quietSince } },
        select: {
          studentId: true,
          progress: { select: { lessonId: true, isCompleted: true, updatedAt: true } },
        },
      },
    },
  })

  let sent = 0
  for (const course of courses) {
    const lessons = course.sections.flatMap((s) => s.lessons)
    if (lessons.length === 0 || course.enrollments.length === 0) continue
    const lessonIds = new Set(lessons.map((l) => l.id))
    const testIds = lessons.filter((l) => l.type === "QUIZ").map((l) => l.id)
    const studentIds = course.enrollments.map((e) => e.studentId)
    const link = reminderLink(course.id)

    const [attempts, recentReminders] = await Promise.all([
      testIds.length > 0
        ? prisma.quizAttempt.findMany({
            where: { lessonId: { in: testIds }, userId: { in: studentIds } },
            select: { userId: true, lessonId: true, passed: true, createdAt: true },
          })
        : [],
      // A week between nudges, whoever sent the last one.
      prisma.notification.findMany({
        where: { type: "HOMEWORK_REMINDER", link, userId: { in: studentIds }, createdAt: { gte: quietSince } },
        select: { userId: true },
      }),
    ])
    const remindedThisWeek = new Set(recentReminders.map((n) => n.userId))

    for (const e of course.enrollments) {
      if (remindedThisWeek.has(e.studentId)) continue
      const mine = attempts.filter((a) => a.userId === e.studentId)
      const completed = e.progress.filter((p) => p.isCompleted && lessonIds.has(p.lessonId)).length
      const passed = new Set(mine.filter((a) => a.passed).map((a) => a.lessonId)).size
      const outstanding = completed < lessons.length || passed < testIds.length
      const lastActive = Math.max(0, ...e.progress.map((p) => p.updatedAt.getTime()), ...mine.map((a) => a.createdAt.getTime()))
      if (!outstanding || lastActive >= quietSince.getTime()) continue

      // Weekly key: at most one automatic nudge per student, course and week.
      const week = Math.floor(now.getTime() / (7 * DAY))
      if (!(await claim(`homework:${course.id}:${e.studentId}:${week}`))) continue
      const left = lessons.length - completed
      if (await createNotification(
        e.studentId,
        "HOMEWORK_REMINDER",
        `Time to catch up on "${course.title}"`,
        `You have ${left} lesson${left === 1 ? "" : "s"} waiting on ${course.title}. A few minutes today keeps you on track for your next class.`,
        link,
      )) sent++
    }
  }
  return sent
}

export async function runReminders(now: Date = new Date()) {
  const classes = await classReminders(now)
  const unlocked = await unlockReminders(now)
  const homework = await homeworkReminders(now)
  // Keys only need to outlive the windows they guard (a week at most).
  await prisma.reminderSent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * DAY) } } })
  return { classes, unlocked, homework }
}
