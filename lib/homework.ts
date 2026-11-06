/**
 * Homework tracking — who has fallen behind on a course, and reminding them.
 *
 * Shared by the course's student list (which reports it) and the reminder
 * route (which sends and records the nudge), so both agree on what "behind"
 * means and on which notifications count as reminders for a course.
 */

/**
 * A student with work outstanding and no activity for this long is "behind" —
 * counted from when they joined the course if they have not started yet.
 */
export const BEHIND_AFTER_DAYS = 7

/** A student is not sent a second reminder for the same course within this window. */
export const REMINDER_COOLDOWN_HOURS = 20

/**
 * Where a reminder sends the student. It doubles as the key the reminder
 * history is read back by: every HOMEWORK_REMINDER notification carrying this
 * link is a reminder for that course.
 */
export function reminderLink(courseId: string): string {
  return `/student/lessons?courseId=${courseId}`
}

/**
 * The nudge for a student well behind the rest of their class: it tells them
 * so, but kindly — the point is to get them going again, not to shame them.
 */
export function behindClassTitle(courseTitle: string): string {
  return `You can catch up on ${courseTitle}!`
}

export function behindClassBody(courseTitle: string, teacherName?: string): string {
  return `${teacherName ? `${teacherName} is cheering you on! ` : ""}` +
    `Most of your class is a little ahead of you on "${courseTitle}" right now — but you can do it. ` +
    `Keep it up: revise your lessons and finish your tests, and you will soon be right there with them.`
}
