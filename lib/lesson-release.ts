import type { Prisma } from "@/app/generated/prisma/client"

/**
 * Scheduled release of lessons and tests.
 *
 * A lesson with `releaseAt` in the future exists — staff and teachers can see
 * and prepare it — but students do not get it until that moment. That lets the
 * school build a whole term in advance and have each week's lessons and tests
 * appear on their own. Students see the lesson in their course outline as
 * locked, with the date it unlocks, so they know what is coming; opening it,
 * its files, its test or its progress is refused until then. Every
 * student-facing read goes through these helpers so a lesson cannot be
 * shown as locked yet still be opened by its link.
 */

/** Prisma `where` fragment: only lessons students may see right now. */
export function releasedLessons(now: Date = new Date()): Prisma.LessonWhereInput {
  return { OR: [{ releaseAt: null }, { releaseAt: { lte: now } }] }
}

export function isReleased(lesson: { releaseAt: Date | null }, now: Date = new Date()): boolean {
  return !lesson.releaseAt || lesson.releaseAt <= now
}

/**
 * "Mon 20 Oct, 09:00" — how a release moment is written wherever a student or
 * teacher sees one, so the lesson list, the lesson page and the app agree.
 */
export function releaseLabel(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when
  if (Number.isNaN(d.getTime())) return ""
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
}

// ─── Moving release dates (copying a course for another group) ───────────────

/** The date and time a clock on the wall shows in `timeZone` at this instant. */
function wallClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") }
}

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * The same time of day, `days` calendar days later (or earlier), as people in
 * `timeZone` read the clock. Adding 24-hour blocks is not enough: a lesson that
 * releases at 09:00 in September would land at 08:00 once the clocks go back,
 * and a September course copied for a November group crosses exactly that.
 */
export function shiftReleaseAt(date: Date, days: number, timeZone: string): Date {
  const w = wallClock(date, timeZone)
  // The target wall-clock time, written as if it were UTC…
  const wall = Date.UTC(w.year, w.month - 1, w.day + days, w.hour, w.minute, w.second)
  // …then moved back by the zone's offset. Twice, so the offset used is the one
  // in force at the result rather than at the first guess.
  let utc = wall - zoneOffsetMs(new Date(wall), timeZone)
  utc = wall - zoneOffsetMs(new Date(utc), timeZone)
  return new Date(utc)
}

/**
 * Reads a `releaseAt` sent by the lesson forms: an ISO date-time, or null /
 * empty for "available straight away". Returns `undefined` when it is not a
 * valid date, so the caller can answer 400 instead of storing nonsense.
 */
export function parseReleaseAt(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null
  if (typeof value !== "string") return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
