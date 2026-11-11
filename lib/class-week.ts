/**
 * Which week of the course a class is ("Week 3"), shown next to its date so
 * the teacher knows which slides to use. Set when a weekly series is
 * scheduled (numbered on from the first class) and changed per class from the
 * course page.
 */

export const MAX_WEEK = 52

/** A week from a request body: a number 1–52, null to clear it, undefined if not sent or not valid. */
export function parseWeek(value: unknown): number | null | undefined {
  if (value === null) return null
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_WEEK) return undefined
  return n
}

export function weekLabel(week: number | null | undefined): string | null {
  return week ? `Week ${week}` : null
}
