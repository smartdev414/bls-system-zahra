import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { isStaff, STAFF_ROLES } from "@/lib/permissions"
import { deleteCourseAnswerVideos } from "@/lib/test-recordings"
import { createNotification, createNotifications } from "@/lib/notifications"

/**
 * Groups on a course.
 *
 * A course is one level; each group on it is one class, with its own students
 * and its own day and time. These helpers keep the three things that follow
 * from that in step, wherever the change is made from:
 *
 *   on the course      → enrolled (sees the lessons)
 *   in the group       → invited to that group's upcoming classes
 *   off the course     → no longer invited to any of its classes
 */

type Actor = { sub: string; name: string }

/** Classes that have not happened yet. */
const UPCOMING = { in: ["SCHEDULED", "LIVE"] as ("SCHEDULED" | "LIVE")[] }

/**
 * Prisma `where` fragment for the groups a person may use: staff see every
 * group; a tutor their own plus the ones the office set up.
 */
export function usableGroups(session: { role: string; sub: string }): Prisma.StudentGroupWhereInput {
  if (isStaff(session.role)) return {}
  return { OR: [{ tutorId: session.sub }, { tutor: { role: { in: [...STAFF_ROLES] } } }] }
}

/**
 * Put students on a course. Skips anyone already on it and anyone who is not a
 * student, tells the new ones, and tells the course's lead when somebody else
 * did it. Returns the ids that were actually added.
 */
export async function enrolStudents(
  course: { id: string; title: string; tutorId: string },
  studentIds: string[],
  actor: Actor,
  /** False when the caller tells the students itself (e.g. in their approval email). */
  { notifyStudents = true }: { notifyStudents?: boolean } = {},
): Promise<{ added: string[]; skipped: number }> {
  const students = await prisma.user.findMany({
    where: { id: { in: [...new Set(studentIds)] }, role: "STUDENT" },
    select: { id: true },
  })
  const alreadyOn = await prisma.enrollment.findMany({
    where: { courseId: course.id, studentId: { in: students.map((s) => s.id) } },
    select: { studentId: true },
  })
  const skip = new Set(alreadyOn.map((e) => e.studentId))
  const added = students.map((s) => s.id).filter((sid) => !skip.has(sid))
  if (added.length === 0) return { added, skipped: skip.size }

  await prisma.enrollment.createMany({
    data: added.map((studentId) => ({ studentId, courseId: course.id })),
    skipDuplicates: true,
  })

  // Anyone who is already in one of this course's groups (taken off the course
  // earlier and now put back, say) rejoins that group's upcoming classes.
  const groupClasses = await prisma.liveSession.findMany({
    where: { courseId: course.id, status: UPCOMING, groupId: { not: null } },
    select: {
      id: true,
      group: { select: { members: { where: { studentId: { in: added } }, select: { studentId: true } } } },
    },
  })
  const invites = groupClasses.flatMap((s) =>
    (s.group?.members ?? []).map((m) => ({ sessionId: s.id, studentId: m.studentId })),
  )
  if (invites.length > 0) {
    await prisma.liveSessionInvite.createMany({ data: invites, skipDuplicates: true })
  }

  if (notifyStudents) {
    void createNotifications(
      added,
      "NEW_ENROLLMENT",
      "You've been added to a course",
      `${actor.name} enrolled you in "${course.title}"`,
      `/student/lessons?courseId=${course.id}`,
    )
  }
  // The lead only needs telling when somebody else did it for them.
  if (course.tutorId !== actor.sub) {
    void createNotification(
      course.tutorId,
      "NEW_ENROLLMENT",
      "Students added to your course",
      `${actor.name} enrolled ${added.length} student${added.length === 1 ? "" : "s"} in "${course.title}"`,
      `/tutor/courses/${course.id}`,
    )
  }

  return { added, skipped: skip.size }
}

/**
 * Students joined a group: put them on the courses that group takes, and
 * invite them to the group's classes that are still to come.
 */
export async function onGroupMembersAdded(groupId: string, studentIds: string[], actor: Actor): Promise<void> {
  if (studentIds.length === 0) return

  const [links, sessions] = await Promise.all([
    prisma.courseGroup.findMany({
      where: { groupId },
      select: { course: { select: { id: true, title: true, tutorId: true } } },
    }),
    prisma.liveSession.findMany({ where: { groupId, status: UPCOMING }, select: { id: true } }),
  ])

  for (const { course } of links) {
    await enrolStudents(course, studentIds, actor)
  }
  if (sessions.length > 0) {
    await prisma.liveSessionInvite.createMany({
      data: sessions.flatMap((s) => studentIds.map((studentId) => ({ sessionId: s.id, studentId }))),
      skipDuplicates: true,
    })
  }
}

/**
 * Students left a group: they are no longer invited to its upcoming classes.
 * They stay on the course — taking someone out of a group must not throw away
 * their lesson progress.
 */
export async function onGroupMembersRemoved(groupId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return
  await prisma.liveSessionInvite.deleteMany({
    where: { studentId: { in: studentIds }, session: { groupId, status: UPCOMING } },
  })
}

/**
 * A student was taken off a course: drop their invitations to its upcoming
 * classes, so a class for a course they are no longer on does not stay in
 * their timetable.
 */
export async function onStudentRemovedFromCourse(courseId: string, studentId: string): Promise<void> {
  await prisma.liveSessionInvite.deleteMany({
    where: { studentId, session: { courseId, status: UPCOMING } },
  })
  // Their recordings in the course's tests go with them.
  await deleteCourseAnswerVideos(courseId, studentId)
}
