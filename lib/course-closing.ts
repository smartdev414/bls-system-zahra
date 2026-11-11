import type { Prisma } from "@/app/generated/prisma/client"

/**
 * Closing a course when it finishes.
 *
 * `Course.closesAt` is the moment the course ends. From then on its students
 * can no longer open its lessons, tests or files, and the course drops out of
 * their dashboard, homework and reminders. A student whose courses have all
 * finished is shown a "your course has finished" page instead of the student
 * space (lib/single-session.ts) — joining a new course opens it again.
 *
 * Staff set it from the course page: close now, or pick the day it closes on
 * its own. Null = open.
 */

/** Prisma `where` fragment: courses that have not closed yet. */
export function openCourses(now: Date = new Date()): Prisma.CourseWhereInput {
  return { OR: [{ closesAt: null }, { closesAt: { gt: now } }] }
}

export function isCourseClosed(course: { closesAt: Date | string | null }, now: Date = new Date()): boolean {
  if (!course.closesAt) return false
  return new Date(course.closesAt).getTime() <= now.getTime()
}

/** What a student is told when they try to open something on a closed course. */
export const COURSE_CLOSED_MESSAGE = "This course has finished, so its lessons and tests are closed."
