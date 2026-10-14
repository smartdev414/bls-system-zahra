import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { createNotifications } from "@/lib/notifications"

/**
 * Sign-up approval — keeping strangers off the platform.
 *
 * A student who signs up on their own starts PENDING: they can sign in, but the
 * proxy keeps them on /pending and `getSession` treats them as signed out until
 * an admin or support member approves them. Students who arrive through a
 * tutor's invite were vouched for, so they start ACTIVE. Admins can switch
 * approval off for students altogether in Settings.
 *
 * Tutors still go through their own check (`TutorProfile.isVerified`, which
 * doubles as the "Verified tutor" badge students see) — this module only adds
 * them to the same waiting list and the same staff alert.
 */

const SETTINGS_ID = "default"

/** Whether a student signing up on their own has to wait for approval. */
export async function studentApprovalRequired(): Promise<boolean> {
  const settings = await prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } })
  return settings?.studentApprovalRequired ?? true
}

export async function setStudentApprovalRequired(required: boolean): Promise<void> {
  await prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, studentApprovalRequired: required },
    update: { studentApprovalRequired: required },
  })
}

/** Everyone staff still have to decide on: new students, and tutors not yet verified. */
export const AWAITING_APPROVAL: Prisma.UserWhereInput = {
  OR: [
    { role: "STUDENT", status: "PENDING" },
    { role: "TUTOR", tutorProfile: { isVerified: false } },
  ],
}

/** Longest note a student can leave on the sign-up form. */
export const SIGNUP_NOTE_MAX = 300

export function cleanSignupNote(note: unknown): string | null {
  if (typeof note !== "string") return null
  const trimmed = note.trim().slice(0, SIGNUP_NOTE_MAX)
  return trimmed || null
}

/**
 * Tells every admin and support member that someone new is waiting. Each role
 * gets a link into its own Users page, already filtered to the waiting list.
 */
export async function notifyStaffOfSignup(user: {
  name: string
  email: string
  role: string
  signupNote?: string | null
}): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "SUPPORT"] } },
      select: { id: true, role: true },
    })
    const who = user.role === "TUTOR" ? "tutor" : "student"
    const title = `New ${who} waiting for approval`
    const body = `${user.name} (${user.email}) signed up as a ${who}.${
      user.signupNote ? ` They said: "${user.signupNote}"` : ""
    }`

    for (const role of ["ADMIN", "SUPPORT"] as const) {
      const ids = staff.filter((s) => s.role === role).map((s) => s.id)
      const link = `/${role === "ADMIN" ? "admin" : "support"}/users?status=pending`
      await createNotifications(ids, "ACCOUNT_PENDING_APPROVAL", title, body, link)
    }
  } catch (err) {
    // Sign-up itself succeeded; the account still shows on the waiting list.
    console.error("[account-approval] notifyStaffOfSignup failed", err)
  }
}
