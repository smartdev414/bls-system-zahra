/**
 * How a student is doing on each of their courses, as faces they understand at
 * a glance, and whether to stop them with the "you're falling behind" notice.
 *
 * Built on the class roster (lib/course-roster.ts), so a student sees the same
 * verdict their teacher sees on the course page: the "Behind the class" /
 * "Not active" badge there is what puts the notice up here.
 *
 *   Faces, per area (lessons, tests) of the work released so far:
 *     happy — three-quarters or more done, or nothing left to do
 *     okay  — some done, some still to do
 *     sad   — under 40% done with three or more things missing
 *
 *   Notice: on a running course and behind. Once the student presses
 *   "I understand" it stays away for a week while they catch up; a teacher
 *   pressing Encourage/Remind brings it back straight away.
 */
import prisma from "@/lib/prisma"
import { courseRoster } from "@/lib/course-roster"
import { openCourses } from "@/lib/course-closing"

export type Mood = "happy" | "okay" | "sad"

export type AreaStanding = {
  key: "lessons" | "tests"
  label: string
  done: number
  total: number
  mood: Mood
}

export type CourseStanding = {
  courseId: string
  title: string
  /** Lessons and tests done of everything released: 0–100. */
  percent: number
  classAverage: number
  /** Nothing done for a week with work waiting. */
  inactive: boolean
  /** Well below the rest of the class. */
  behindClass: boolean
  behind: boolean
  /** Areas with something released in them. */
  areas: AreaStanding[]
  /** Show the "you're falling behind" notice for this course now. */
  noticeDue: boolean
}

/** How long "I understand" keeps the notice away while the student stays behind. */
export const NOTICE_SNOOZE_DAYS = 7

export function moodOf(done: number, total: number): Mood {
  const missing = Math.max(0, total - done)
  if (missing === 0 || done / total >= 0.75) return "happy"
  if (done / total < 0.4 && missing >= 3) return "sad"
  return "okay"
}

export async function studentStanding(studentId: string, now: Date = new Date()): Promise<CourseStanding[]> {
  const enrolments = await prisma.enrollment.findMany({
    where: { studentId, course: { status: "PUBLISHED", ...openCourses(now) } },
    orderBy: { enrolledAt: "asc" },
    select: { courseId: true, behindNoticeSeenAt: true, course: { select: { title: true } } },
  })

  const snoozedSince = now.getTime() - NOTICE_SNOOZE_DAYS * 24 * 60 * 60 * 1000
  const standings = await Promise.all(enrolments.map(async (e) => {
    const roster = await courseRoster(e.courseId, now)
    const me = roster.students.find((s) => s.id === studentId)
    if (!me || roster.totalWork === 0) return null

    const areas: AreaStanding[] = []
    if (roster.totalLessons > 0) {
      areas.push({ key: "lessons", label: "Lessons", done: me.completedLessons, total: roster.totalLessons, mood: moodOf(me.completedLessons, roster.totalLessons) })
    }
    if (roster.totalTests > 0) {
      areas.push({ key: "tests", label: "Tests", done: me.testsDone, total: roster.totalTests, mood: moodOf(me.testsDone, roster.totalTests) })
    }
    const seen = e.behindNoticeSeenAt?.getTime() ?? null
    return {
      courseId: e.courseId,
      title: e.course.title,
      percent: me.percent,
      classAverage: roster.classAverage,
      inactive: me.inactive,
      behindClass: me.behindClass,
      behind: me.behind,
      areas,
      noticeDue: me.behind && (seen === null || seen < snoozedSince),
    }
  }))
  return standings.filter((s): s is CourseStanding => s !== null)
}
