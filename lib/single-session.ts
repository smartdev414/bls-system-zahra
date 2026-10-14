import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { getPusher } from "@/lib/pusher-server"

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
  void notifyReplaced(userId)
  return sid
}

async function notifyReplaced(userId: string) {
  try {
    await getPusher().trigger(`private-user-${userId}`, "session-replaced", {})
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
 *
 * Tokens issued before the single-device rule carry no sid; they stay valid
 * until the student next signs in anywhere.
 */
export type SessionState = "ok" | "replaced" | "pending" | "rejected"

export async function sessionState(payload: { sub: string; role: string; sid?: string }): Promise<SessionState> {
  if (payload.role !== "STUDENT") return "ok"
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { activeSessionId: true, status: true },
  })
  if (!user) return "replaced"
  if (user.activeSessionId && user.activeSessionId !== payload.sid) return "replaced"
  if (user.status === "PENDING") return "pending"
  if (user.status === "REJECTED") return "rejected"
  return "ok"
}
