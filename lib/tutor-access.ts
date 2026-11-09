import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession, type SessionPayload } from "@/lib/auth"
import { FULL_ACCESS, VIEW_ONLY_MESSAGE, type TutorAccess, type TutorArea } from "@/lib/tutor-areas"

export * from "@/lib/tutor-areas"

// Server side of the per-teacher switches described in lib/tutor-areas.ts.

const COLUMN = {
  tests: "canEditTests",
  calendar: "canEditCalendar",
  library: "canEditLibrary",
  groups: "canEditGroups",
  students: "canEditStudents",
  download: "canDownload",
} as const satisfies Record<TutorArea, string>

// A teacher with no profile row yet gets what a new profile starts with.
const NO_ACCESS: TutorAccess = {
  tests: false, calendar: true, library: false, groups: false, students: false, download: false,
}

type ProfileRow = Partial<Record<(typeof COLUMN)[TutorArea], boolean>>

export function accessFromProfile(row: ProfileRow | null | undefined): TutorAccess {
  if (!row) return NO_ACCESS
  return Object.fromEntries(
    (Object.keys(COLUMN) as TutorArea[]).map((a) => [a, row[COLUMN[a]] ?? false]),
  ) as TutorAccess
}

/** The profile columns to `select` for `accessFromProfile`. */
export const ACCESS_SELECT = Object.fromEntries(
  Object.values(COLUMN).map((c) => [c, true]),
) as Record<(typeof COLUMN)[TutorArea], true>

/** Prisma `data` for saving a (partial) access change. */
export function accessToProfileData(access: Partial<TutorAccess>): ProfileRow {
  const data: ProfileRow = {}
  for (const a of Object.keys(COLUMN) as TutorArea[]) {
    if (typeof access[a] === "boolean") data[COLUMN[a]] = access[a]
  }
  return data
}

/** Everyone but a tutor has full access; a tutor has what an admin gave them. */
export async function getTutorAccess(session: Pick<SessionPayload, "role" | "sub">): Promise<TutorAccess> {
  if (session.role !== "TUTOR") return FULL_ACCESS
  const profile = await prisma.tutorProfile.findUnique({
    where: { userId: session.sub },
    select: ACCESS_SELECT,
  })
  return accessFromProfile(profile)
}

/**
 * Route guard: a 403 for a tutor who is not allowed to change `area`, or null.
 * Call it after the role/capability check.
 */
export async function requireTutorAccess(
  session: Pick<SessionPayload, "role" | "sub">,
  area: TutorArea,
): Promise<NextResponse | null> {
  if (session.role !== "TUTOR") return null
  const access = await getTutorAccess(session)
  return access[area] ? null : NextResponse.json({ message: VIEW_ONLY_MESSAGE[area] }, { status: 403 })
}

/**
 * Wraps a write handler so a tutor without `area` gets a 403 before it runs.
 *
 *   export const POST = withAudit(tutorWrite("tests", handlePOST))
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tutorWrite<C = any>(
  area: TutorArea,
  handler: (req: NextRequest, ctx: C) => Promise<NextResponse>,
): (req: NextRequest, ctx: C) => Promise<NextResponse> {
  return async (req, ctx) => {
    const session = await getSession()
    if (session) {
      const denied = await requireTutorAccess(session, area)
      if (denied) return denied
    }
    return handler(req, ctx)
  }
}
