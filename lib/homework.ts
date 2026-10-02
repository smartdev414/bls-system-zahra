/**
 * Homework tracking — who has fallen behind on a course, and reminding them.
 *
 * Shared by the course's student list (which reports it) and the reminder
 * route (which sends and records the nudge), so both agree on what "behind"
 * means and on which notifications count as reminders for a course.
 */

/** A student with work outstanding and no activity for this long is "behind". */
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
