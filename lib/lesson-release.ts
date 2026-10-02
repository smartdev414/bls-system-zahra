import type { Prisma } from "@/app/generated/prisma/client"

/**
 * Scheduled release of lessons and tests.
 *
 * A lesson with `releaseAt` in the future exists — staff and teachers can see
 * and prepare it — but students do not get it until that moment. That lets the
 * school build a whole term in advance and have each week's lessons and tests
 * appear on their own. Every student-facing read goes through these two helpers
 * so a lesson cannot be hidden from the list yet still be opened by its link.
 */

/** Prisma `where` fragment: only lessons students may see right now. */
export function releasedLessons(now: Date = new Date()): Prisma.LessonWhereInput {
  return { OR: [{ releaseAt: null }, { releaseAt: { lte: now } }] }
}

export function isReleased(lesson: { releaseAt: Date | null }, now: Date = new Date()): boolean {
  return !lesson.releaseAt || lesson.releaseAt <= now
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
