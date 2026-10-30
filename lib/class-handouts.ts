/**
 * Class handouts: files a tutor gives a class's students to keep, opened to
 * them at a set date and time (by default when the class ends).
 *
 * Students are told when a handout opens — by the reminders job for ones set
 * to open later, or straight away when the time is already past on upload.
 * Each student is told about each handout once, guarded by `ReminderSent`.
 */
import prisma from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { studentOwnSessions } from "@/lib/session-access"

const DAY = 24 * 60 * 60 * 1000

/** Where students find their handouts. */
export const HANDOUTS_LINK = "/student/resources"

/** When a class's handouts open unless the tutor picks another time: the end of the class. */
export function classEnd(s: { scheduledAt: Date; durationMins: number }): Date {
  return new Date(s.scheduledAt.getTime() + s.durationMins * 60 * 1000)
}

/** The students a class's handouts are for: those it was run for, and anyone who sat in. */
async function handoutStudents(sessionId: string): Promise<string[]> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      visibility: true,
      courseId: true,
      invites: { select: { studentId: true } },
      joinRequests: { where: { status: "APPROVED" }, select: { studentId: true } },
      attendances: { select: { studentId: true } },
    },
  })
  if (!session) return []
  const enrolled = session.visibility === "PUBLIC" && session.courseId
    ? await prisma.enrollment.findMany({ where: { courseId: session.courseId }, select: { studentId: true } })
    : []
  return [...new Set(
    [...session.invites, ...session.joinRequests, ...session.attendances, ...enrolled].map((r) => r.studentId),
  )]
}

async function claim(key: string): Promise<boolean> {
  try {
    await prisma.reminderSent.create({ data: { key } })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false
    throw err
  }
}

/**
 * Tells students about handouts that have opened in the last two days (or,
 * with `sessionId`, only that class's). One message per student per class,
 * however many files opened at once. Returns how many were sent.
 */
export async function announceHandouts(now: Date = new Date(), sessionId?: string): Promise<number> {
  const opened = await prisma.classHandout.findMany({
    where: {
      releaseAt: { lte: now, gt: new Date(now.getTime() - 2 * DAY) },
      session: { status: { not: "CANCELLED" } },
      ...(sessionId ? { sessionId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, sessionId: true, session: { select: { title: true } } },
  })

  const bySession = new Map<string, typeof opened>()
  for (const h of opened) bySession.set(h.sessionId, [...(bySession.get(h.sessionId) ?? []), h])

  let sent = 0
  for (const [id, handouts] of bySession) {
    const classTitle = handouts[0].session.title
    for (const studentId of await handoutStudents(id)) {
      const fresh: typeof handouts = []
      for (const h of handouts) if (await claim(`handout:${h.id}:${studentId}`)) fresh.push(h)
      if (!fresh.length) continue
      const title = fresh.length === 1 ? `Class handout: ${fresh[0].title}` : `${fresh.length} handouts from ${classTitle}`
      const body = fresh.length === 1
        ? `Your handout from "${classTitle}" is ready to download.`
        : `Your handouts from "${classTitle}" are ready to download: ${fresh.map((h) => h.title).join(", ")}.`
      if (await createNotification(studentId, "CLASS_HANDOUT_READY", title, body, HANDOUTS_LINK)) sent++
    }
  }
  return sent
}

/** The handouts a student can open now, newest class first. */
export async function releasedHandoutsFor(studentId: string, now: Date = new Date()) {
  return prisma.classHandout.findMany({
    where: {
      releaseAt: { lte: now },
      session: { status: { not: "CANCELLED" }, ...studentOwnSessions(studentId) },
    },
    orderBy: [{ session: { scheduledAt: "desc" } }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      fileUrl: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      releaseAt: true,
      session: {
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          course: { select: { title: true } },
          tutor: { select: { name: true } },
        },
      },
    },
  })
}
