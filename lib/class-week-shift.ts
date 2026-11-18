import prisma from "@/lib/prisma"
import { MAX_WEEK } from "@/lib/class-week"

/**
 * Keeping the course weeks in step when a class is cancelled or put back on.
 *
 * A course's weeks are its lessons in order, so a cancelled class's lesson is
 * not skipped: it goes to the next class, and every class after moves up one.
 * Cancel 23 Nov (Week 5) and 24 Nov (was Week 6) becomes Week 5, 25 Nov
 * becomes Week 6, and so on. "After" means on the same timetable: the same
 * course and the same group (or the whole course's classes).
 */

type Cancelled = { id: string; courseId: string | null; groupId: string | null; scheduledAt: Date; week: number | null }

const timetableKey = (s: { courseId: string | null; groupId: string | null }) => `${s.courseId}|${s.groupId ?? ""}`

/**
 * Call after the classes are marked cancelled. Returns how many classes got a
 * new week.
 */
export async function shiftWeeksAfterCancel(cancelled: Cancelled[]): Promise<number> {
  const byTimetable = new Map<string, Cancelled[]>()
  for (const c of cancelled) {
    if (!c.courseId || c.week == null) continue
    const k = timetableKey(c)
    byTimetable.set(k, [...(byTimetable.get(k) ?? []), c])
  }

  let changed = 0
  for (const group of byTimetable.values()) {
    const { courseId, groupId } = group[0]
    const from = new Date(Math.min(...group.map((c) => c.scheduledAt.getTime())))
    const later = await prisma.liveSession.findMany({
      where: { courseId, groupId, status: "SCHEDULED", week: { not: null }, scheduledAt: { gt: from } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, scheduledAt: true, week: true },
    })
    // The weeks in date order, the cancelled classes' included, handed out in
    // turn to the classes still going ahead. Any left at the end are lessons
    // that now need a class adding.
    const weeks = [...group, ...later]
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .map((s) => s.week!)
    const updates = later.flatMap((s, i) => (weeks[i] !== s.week ? [{ id: s.id, week: weeks[i] }] : []))
    if (updates.length > 0) {
      await prisma.$transaction(updates.map((u) => prisma.liveSession.update({ where: { id: u.id }, data: { week: u.week } })))
    }
    changed += updates.length
  }
  return changed
}

/**
 * Call after a cancelled class is put back on: it keeps its week, and the
 * classes after it move back down one.
 */
export async function shiftWeeksAfterRestore(restored: Cancelled): Promise<number> {
  if (!restored.courseId || restored.week == null) return 0
  const later = await prisma.liveSession.findMany({
    where: {
      courseId: restored.courseId,
      groupId: restored.groupId,
      status: "SCHEDULED",
      week: { not: null, gte: restored.week },
      scheduledAt: { gt: restored.scheduledAt },
      id: { not: restored.id },
    },
    select: { id: true, week: true },
  })
  const updates = later.filter((s) => s.week! < MAX_WEEK)
  if (updates.length > 0) {
    await prisma.$transaction(updates.map((s) => prisma.liveSession.update({ where: { id: s.id }, data: { week: s.week! + 1 } })))
  }
  return updates.length
}
