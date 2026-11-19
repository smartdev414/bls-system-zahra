import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { isStaff } from "@/lib/permissions"

/**
 * Prisma `where` fragment for the classes a tutor runs as host: the ones they
 * own, and every class on a course they teach (they lead it, or an admin put
 * them on it as a teacher). A teacher put on a course takes its classes even
 * when someone else scheduled them, so they can see, start and run them.
 * Co-tutors invited to one class are separate (`coTutors`); they join a class
 * but do not start or manage it.
 */
export function hostedBy(tutorId: string): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { tutorId },
      { course: { OR: [{ tutorId }, { teachers: { some: { tutorId } } }] } },
    ],
  }
}

/** `hostedBy` for a tutor; staff (admin, support) see every class. */
export function hostScope(auth: { role: string; sub: string }): Prisma.LiveSessionWhereInput {
  return isStaff(auth.role) ? {} : hostedBy(auth.sub)
}

/** Is this person a host of the class: its owner or a teacher on its course? */
export async function isSessionHost(
  auth: { role: string; sub: string },
  sessionId: string,
): Promise<boolean> {
  if (auth.role !== "TUTOR" && auth.role !== "ADMIN") return false
  const found = await prisma.liveSession.findFirst({
    where: { id: sessionId, ...hostedBy(auth.sub) },
    select: { id: true },
  })
  return !!found
}

/**
 * Which students a live session is for.
 *
 *   INVITE_ONLY          — students holding an invite or an approved join request.
 *   PUBLIC, on a course  — everyone enrolled on that course. A course is one
 *                          level (Level 1, Level 2, …), so this is what keeps a
 *                          Level 1 student out of the Level 2 class.
 *   PUBLIC, no course    — any signed-in student (open taster sessions).
 *
 * Every student-facing gate (room token, chat, slides, recordings' chat files)
 * goes through here so the rule cannot drift between them.
 */
export async function studentMayJoinSession(
  liveSession: { id: string; visibility: string; courseId: string | null },
  studentId: string,
): Promise<boolean> {
  if (liveSession.visibility !== "INVITE_ONLY" && !liveSession.courseId) return true

  const [invite, approvedRequest, enrolment] = await Promise.all([
    prisma.liveSessionInvite.findUnique({
      where: { sessionId_studentId: { sessionId: liveSession.id, studentId } },
      select: { id: true },
    }),
    prisma.sessionJoinRequest.findFirst({
      where: { sessionId: liveSession.id, studentId, status: "APPROVED" },
      select: { id: true },
    }),
    liveSession.visibility !== "INVITE_ONLY" && liveSession.courseId
      ? prisma.enrollment.findUnique({
          where: { studentId_courseId: { studentId, courseId: liveSession.courseId } },
          select: { id: true },
        })
      : null,
  ])

  return !!(invite || approvedRequest || enrolment)
}

/**
 * Prisma `where` fragment for the sessions a student is shown in their lists.
 *
 * Sessions with no course keep the open behaviour (invite-only ones are listed
 * so a student can ask to join). A course's classes are stricter: the whole-
 * course ones are listed for students on that course, and a class run for one
 * group is listed only for the students invited to it — the other groups on
 * the same course have their own day and time and never see it.
 */
export function studentVisibleSessions(studentId: string): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { courseId: null },
      { visibility: "PUBLIC", course: { enrollments: { some: { studentId } } } },
      { invites: { some: { studentId } } },
      { joinRequests: { some: { studentId } } },
    ],
  }
}

/**
 * Prisma `where` fragment for a student's own classes — the ones run for them
 * (invited, let in on request, or a whole-course class on a course they are
 * on) or that they sat in. Unlike `studentVisibleSessions` it leaves out open
 * sessions anyone may browse, so "your next class" is really theirs.
 */
export function studentOwnSessions(studentId: string): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { invites: { some: { studentId } } },
      { joinRequests: { some: { studentId, status: "APPROVED" } } },
      { visibility: "PUBLIC", course: { enrollments: { some: { studentId } } } },
      { attendances: { some: { studentId } } },
    ],
  }
}

/**
 * Prisma `where` fragment for who may watch a class's recording: the tutor who
 * ran it, and the students it was for — including those who missed it, since
 * catching up is what a recording is for — unless the recording is hidden from
 * students. Admins are let through by the caller.
 */
export function recordingViewers(userId: string): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { tutorId: userId },
      { AND: [{ recordingHidden: false }, studentOwnSessions(userId)] },
    ],
  }
}

/**
 * Prisma `where` fragment for the students who have been in one of a tutor's
 * classrooms. Joining a class — public or invite-only, on a course or not —
 * makes a student that tutor's student, the same as enrolling on their course
 * does, so the tutor's student list and both sides' message contacts read this.
 */
export function joinedClassOf(tutorId: string): Prisma.UserWhereInput {
  return {
    role: "STUDENT",
    attendances: {
      some: {
        joinedAt: { not: null },
        session: { OR: [hostedBy(tutorId), { coTutors: { some: { tutorId } } }] },
      },
    },
  }
}

/**
 * Who is allowed to read/write the live-classroom side channels (chat history,
 * stage state) for a session.
 *
 * Read access mirrors "could this person be in the room": the owning tutor, any
 * co-tutor, an admin, and the students the session is for — see
 * `studentMayJoinSession`.
 */
export type SessionAccess = {
  id: string
  tutorId: string
  courseId: string | null
  status: string
  visibility: string
  coTutors: { tutorId: string }[]
}

export type AccessResult =
  | { liveSession: SessionAccess; isTutor: boolean; error?: undefined }
  | { error: NextResponse; liveSession?: undefined; isTutor?: undefined }

export async function assertCanAccessSession(
  auth: { role: string; sub: string },
  sessionId: string,
): Promise<AccessResult> {
  const liveSession = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tutorId: true,
      courseId: true,
      status: true,
      visibility: true,
      coTutors: { select: { tutorId: true } },
    },
  })

  if (!liveSession) {
    return { error: NextResponse.json({ message: "Session not found" }, { status: 404 }) }
  }

  if (auth.role === "ADMIN") return { liveSession, isTutor: true }

  const isOwner = auth.role === "TUTOR" && auth.sub === liveSession.tutorId
  // Co-teachers are tutors, or support staff invited as the class's interpreter.
  const isCoTutor =
    (auth.role === "TUTOR" || auth.role === "SUPPORT") &&
    liveSession.coTutors.some((c) => c.tutorId === auth.sub)

  if (isOwner || isCoTutor) return { liveSession, isTutor: true }
  // A teacher on the class's course runs it like its owner.
  if (auth.role === "TUTOR" && (await isSessionHost(auth, sessionId))) return { liveSession, isTutor: true }

  if (auth.role !== "STUDENT") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  if (!(await studentMayJoinSession(liveSession, auth.sub))) {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  return { liveSession, isTutor: false }
}
