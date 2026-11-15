import prisma from "@/lib/prisma"
import { totalsOf, type ReceptiveActivity, type ReceptiveEntry, type ReceptiveTotals } from "@/lib/receptive-log"

const ENTRY_SELECT = { id: true, date: true, activity: true, title: true, minutes: true, notes: true } as const

type Row = { id: string; date: Date; activity: string; title: string; minutes: number; notes: string | null }

/** "date" is a DATE column: Prisma hands it back as UTC midnight. */
export const toEntry = (r: Row): ReceptiveEntry => ({
  id: r.id,
  date: r.date.toISOString().slice(0, 10),
  activity: r.activity as ReceptiveActivity,
  title: r.title,
  minutes: r.minutes,
  notes: r.notes,
})

export const toDbDate = (day: string) => new Date(`${day}T00:00:00Z`)

/** One student's whole log, newest first, with totals. */
export async function receptiveLogOf(userId: string): Promise<{ entries: ReceptiveEntry[]; totals: ReceptiveTotals }> {
  const rows = await prisma.receptiveLog.findMany({
    where: { userId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: ENTRY_SELECT,
  })
  const entries = rows.map(toEntry)
  return { entries, totals: totalsOf(entries) }
}

/** Totals for many students at once, for the teacher's student list. */
export async function receptiveTotals(userIds: string[]): Promise<Map<string, ReceptiveTotals>> {
  const out = new Map<string, ReceptiveTotals>()
  if (userIds.length === 0) return out
  const rows = await prisma.receptiveLog.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, date: true, minutes: true },
  })
  const byUser = new Map<string, Array<{ date: string; minutes: number }>>()
  for (const r of rows) {
    const list = byUser.get(r.userId) ?? []
    list.push({ date: r.date.toISOString().slice(0, 10), minutes: r.minutes })
    byUser.set(r.userId, list)
  }
  for (const [id, list] of byUser) out.set(id, totalsOf(list))
  return out
}

export { ENTRY_SELECT }
