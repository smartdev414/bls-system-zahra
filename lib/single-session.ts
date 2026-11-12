import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { getPusher } from "@/lib/pusher-server"
import { touchActive } from "@/lib/activity-tracking"

// One device per student account: every student login gets a fresh session id
// stored on the user, so a friend signing in with the same account signs the
// previous device out. Tutors, support and admins are left alone — they
// legitimately run a laptop and a phone side by side.

export const SIGNED_IN_ELSEWHERE = "signed-in-elsewhere"

/** Records a new active session for a student and kicks any other device. */
export async function startStudentSession(userId: string): Promise<string> {
  const sid = randomUUID()
  await prisma.user.update({ where: { id: userId }, data: { activeSessionId: sid } })
  // Open tabs on the old device check themselves and leave right away; if this
  // misses, their next page load or API call is rejected anyway.
  //
  // Awaited, not fired and forgotten: on Vercel the function is frozen the
  // moment the login response is sent, and an un-awaited send was often never
  // delivered — the old phone sat on the dashboard until its next click.
  await notifyReplaced(userId)
  return sid
}

// Pusher normally answers in well under a second; never hold a login longer.
const NOTIFY_TIMEOUT_MS = 2_000

/**
 * Asks every open tab of this student to check whether it may stay — used when
 * they sign in elsewhere, and when staff suspend the account.
 */
export async function notifyReplaced(userId: string) {
  try {
    await Promise.race([
      getPusher().trigger(`private-user-${userId}`, "session-replaced", {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), NOTIFY_TIMEOUT_MS)),
    ])
  } catch (err) {
    console.error("[single-session] pusher trigger failed", err)
  }
}

/**
 * Where a verified token stands. For a student this is one lookup that answers
 * two questions: is this still the account's current device, and has staff
 * approved the account yet (see lib/account-approval.ts)?
 *
 *   ok       — carry on
 *   replaced — signed in on another device since; treat as signed out
 *   pending  — signed up, waiting for staff to approve
 *   rejected — staff turned the sign-up down
 *   suspended — staff paused the account (e.g. over behaviour) until they lift it
 *   finished — every course they were on has closed (lib/course-closing.ts), so
 *              the student space is closed to them until they join another
 *
 * Tokens issued before the single-device rule carry no sid; they stay valid
 * until the student next signs in anywhere.
 */
export type SessionState = "ok" | "replaced" | "pending" | "rejected" | "suspended" | "finished"

export async function sessionState(payload: { sub: string; role: string; sid?: string }): Promise<SessionState> {
  if (payload.role !== "STUDENT") return "ok"
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      activeSessionId: true,
      status: true,
      lastActiveAt: true,
      enrollments: { select: { course: { select: { closesAt: true } } } },
    },
  })
  if (!user) return "replaced"
  if (user.activeSessionId && user.activeSessionId !== payload.sid) return "replaced"
  if (user.status === "PENDING") return "pending"
  if (user.status === "REJECTED") return "rejected"
  if (user.status === "SUSPENDED") return "suspended"
  // On courses, and every one of them has finished. A student on no course at
  // all (say, only invited to classes) is not affected.
  const now = Date.now()
  if (user.enrollments.length > 0 &&
      user.enrollments.every((e) => e.course.closesAt !== null && e.course.closesAt.getTime() <= now)) {
    return "finished"
  }
  // Every page load and API call passes through here, which makes it the place
  // to note the student is on the platform (written at most every 2 minutes).
  await touchActive(payload.sub, user.lastActiveAt)
  return "ok"
}
