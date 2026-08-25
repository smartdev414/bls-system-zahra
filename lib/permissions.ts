import { NextResponse } from "next/server"
import type { SessionPayload } from "@/lib/auth"

/**
 * Single source of truth for "who may do what".
 *
 * Role guards used to be spelled out inline (`session.role !== "ADMIN"`), which
 * made adding the Support Team role a scavenger hunt. Routes now ask for a
 * capability instead, so a new role is one row in ROLE_CAPABILITIES.
 */

export type AppRole = "STUDENT" | "TUTOR" | "SUPPORT" | "ADMIN"

export type Capability =
  // ─── Dashboard & people ────────────────────────────────────────────────────
  | "dashboard.view"
  | "users.view"
  | "users.create"
  | "users.edit"
  | "users.delete"
  /** Promote/demote someone into a staff role (ADMIN, SUPPORT). Admin only —
   *  without this, support staff could grant themselves full access. */
  | "users.assignStaffRole"

  // ─── Courses / classes ─────────────────────────────────────────────────────
  | "courses.view"
  | "courses.create"
  | "courses.edit"
  | "courses.delete"
  | "courses.publish"

  // ─── Lesson content & materials (confidential — support staff excluded) ────
  | "lessons.manage"
  | "resources.view"
  | "resources.download"
  | "resources.upload"

  // ─── Enrolment, groups, students ───────────────────────────────────────────
  | "enrolments.manage"
  | "groups.manage"
  | "students.view"
  | "students.invite"

  // ─── Timetable / live sessions ─────────────────────────────────────────────
  | "sessions.view"
  | "sessions.create"
  | "sessions.edit"
  | "sessions.delete"
  | "sessions.invite"
  /** Enter the room as a host and run it (mic control, recording, slides). */
  | "sessions.teach"

  // ─── Dictionary (confidential — support staff excluded) ────────────────────
  | "dictionary.view"
  | "dictionary.manage"

  // ─── Support desk & diagnostics ────────────────────────────────────────────
  | "tickets.viewAll"
  | "tickets.respond"
  | "connectivity.check"

  // ─── Platform administration ───────────────────────────────────────────────
  | "auditLogs.view"
  | "settings.manage"
  | "categories.manage"
  | "certifications.review"

const STUDENT_CAPABILITIES: Capability[] = [
  "courses.view",
  "resources.view",
  "resources.download",
  "dictionary.view",
  "sessions.view",
  "connectivity.check",
]

const TUTOR_CAPABILITIES: Capability[] = [
  "dashboard.view",
  "courses.view",
  "courses.create",
  "courses.edit",
  "courses.delete",
  "courses.publish",
  "lessons.manage",
  "resources.view",
  "resources.download",
  "resources.upload",
  "enrolments.manage",
  "groups.manage",
  "students.view",
  "students.invite",
  "sessions.view",
  "sessions.create",
  "sessions.edit",
  "sessions.delete",
  "sessions.invite",
  "sessions.teach",
  "dictionary.view",
  "connectivity.check",
]

/**
 * Support Team — office staff who run the timetable and look after students.
 *
 * They set classes up and put students in them, but they are deliberately kept
 * out of teaching material: no lesson resources, no dictionary, no downloads,
 * no audit logs, no platform settings, and no ability to hand out staff roles.
 */
const SUPPORT_CAPABILITIES: Capability[] = [
  "dashboard.view",
  "users.view",
  "users.create",
  "users.edit",
  "courses.view",
  "courses.create",
  "courses.edit",
  "courses.publish",
  "enrolments.manage",
  "groups.manage",
  "students.view",
  "students.invite",
  "sessions.view",
  "sessions.create",
  "sessions.edit",
  "sessions.delete",
  "sessions.invite",
  "tickets.viewAll",
  "tickets.respond",
  "connectivity.check",
]

const ADMIN_CAPABILITIES: Capability[] = [
  ...new Set<Capability>([
    ...TUTOR_CAPABILITIES,
    ...SUPPORT_CAPABILITIES,
    "users.delete",
    "users.assignStaffRole",
    "dictionary.manage",
    "auditLogs.view",
    "settings.manage",
    "categories.manage",
    "certifications.review",
  ]),
]

const ROLE_CAPABILITIES: Record<AppRole, ReadonlySet<Capability>> = {
  STUDENT: new Set(STUDENT_CAPABILITIES),
  TUTOR: new Set(TUTOR_CAPABILITIES),
  SUPPORT: new Set(SUPPORT_CAPABILITIES),
  ADMIN: new Set(ADMIN_CAPABILITIES),
}

/** Roles that work on behalf of the organisation rather than a single account. */
export const STAFF_ROLES: AppRole[] = ["ADMIN", "SUPPORT"]

export function isStaff(role: string | undefined): boolean {
  return role === "ADMIN" || role === "SUPPORT"
}

export function can(role: string | undefined, capability: Capability): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role as AppRole]?.has(capability) ?? false
}

export function canAll(role: string | undefined, capabilities: Capability[]): boolean {
  return capabilities.every((c) => can(role, c))
}

export function capabilitiesFor(role: string | undefined): Capability[] {
  if (!role) return []
  return [...(ROLE_CAPABILITIES[role as AppRole] ?? [])]
}

/**
 * Route-handler guard. Returns a response to hand straight back when the caller
 * is not allowed, or null when they are.
 *
 *   const denied = requireCapability(session, "sessions.create")
 *   if (denied) return denied
 */
export function requireCapability(
  session: Pick<SessionPayload, "role"> | null,
  ...capabilities: Capability[]
): NextResponse | null {
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  if (!capabilities.every((c) => can(session.role, c))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }
  return null
}

/**
 * Prisma `where` fragment that limits a tutor to their own records while
 * letting staff (admin, support) see the whole organisation.
 *
 *   where: { ...ownerScope(session), status: "SCHEDULED" }
 */
export function ownerScope(
  session: { role: string; sub: string },
  field: string = "tutorId",
): Record<string, string> {
  return isStaff(session.role) ? {} : { [field]: session.sub }
}

/** Human-readable role name for badges and dropdowns. */
export function roleLabel(role: string): string {
  if (role === "SUPPORT") return "Support Team"
  return role.charAt(0) + role.slice(1).toLowerCase()
}
