/**
 * The order class lists are shown in, for students and tutors alike: what is
 * live now, then today's classes and the weeks after in date order, then past
 * classes newest first. A class that was never started drops into the past
 * once its day is over, so it can't sit above today's class.
 */
type Orderable = { status: string; scheduledAt: string }

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Live, or not yet run and scheduled for today or later. */
export function isUpcomingClass(s: Orderable, todayStart = startOfToday()) {
  if (s.status === "LIVE") return true
  return s.status === "SCHEDULED" && new Date(s.scheduledAt).getTime() >= todayStart
}

/** Sorts a copy of `sessions` into list order. */
export function sortClasses<T extends Orderable>(sessions: T[]): T[] {
  const todayStart = startOfToday()
  const rank = (s: T) => (s.status === "LIVE" ? 0 : isUpcomingClass(s, todayStart) ? 1 : 2)
  return sessions.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    const ta = new Date(a.scheduledAt).getTime(), tb = new Date(b.scheduledAt).getTime()
    return ra === 2 ? tb - ta : ta - tb
  })
}
