"use client"

/**
 * Which decks this teacher actually reached for, most recent first.
 *
 * The server can say what a tutor has uploaded and when. It cannot say what
 * they *use*, and those are different lists: a deck uploaded months ago and
 * taught every week should sit at the top, while last night's one-off upload
 * should not outrank it forever. Ordering the library by upload date is what
 * left teachers hunting for the same file every lesson.
 *
 * Kept per device rather than on the user record, deliberately: it is a
 * shortcut, not a setting. It carries no information that isn't already in the
 * tutor's own session history, it must not need a write to the database on the
 * way into a lesson, and a teacher on a shared staffroom machine should not
 * push their ordering onto the next person's account.
 */

const STORAGE_KEY = "bsl:recent-presentations"

/**
 * Entries kept. Well past what the panel shows, because this only supplies the
 * *ordering* for whatever the server returns — an entry for a deck that has
 * scrolled out of the library costs nothing and restores its place if it
 * reappears.
 */
const LIMIT = 120

type UsageMap = Record<string, number>

function read(): UsageMap {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: UsageMap = {}
    for (const [url, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === "number" && Number.isFinite(ts)) out[url] = ts
    }
    return out
  } catch {
    // Site data disabled, or a corrupt value written by an older build. Either
    // way the library still works — it just falls back to upload order.
    return {}
  }
}

/** When each presentation was last put on screen, keyed by its file URL. */
export function readPresentationUsage(): UsageMap {
  return read()
}

/** Record that a presentation has just been shown to a class. */
export function markPresentationUsed(url: string): void {
  if (!url) return
  try {
    const usage = read()
    usage[url] = Date.now()

    const entries = Object.entries(usage)
    const trimmed = entries.length > LIMIT
      ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LIMIT))
      : usage

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* storage disabled — ordering falls back to upload date */ }
}

/**
 * Sort by last use, falling back to the server's order (upload date) for
 * anything this device has never presented. A deck used once beats a deck never
 * used, which is the whole point.
 */
export function byLastUsed<T extends { url: string }>(items: T[], usage: UsageMap): T[] {
  return [...items]
    .map((item, index) => ({ item, index, usedAt: usage[item.url] ?? 0 }))
    .sort((a, b) => (b.usedAt - a.usedAt) || (a.index - b.index))
    .map((entry) => entry.item)
}
