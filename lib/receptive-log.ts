// Receptive log: time a student spends outside class watching and taking in
// signing (TV with signing, Deaf events, meeting Deaf people...). Shared by the
// student's own page, their teachers' view and the API. No server imports here.

export const RECEPTIVE_ACTIVITIES = ["TV", "FILM", "ONLINE", "DEAF_EVENT", "MET_DEAF", "OTHER"] as const
export type ReceptiveActivity = (typeof RECEPTIVE_ACTIVITIES)[number]

export const ACTIVITY_LABEL: Record<ReceptiveActivity, string> = {
  TV: "TV with signing",
  FILM: "Film or video in BSL",
  ONLINE: "Online / social media",
  DEAF_EVENT: "Deaf club or event",
  MET_DEAF: "Met Deaf people",
  OTHER: "Other",
}

/** Placeholder for "what did you watch / where", per activity. */
export const ACTIVITY_HINT: Record<ReceptiveActivity, string> = {
  TV: "e.g. BBC News with in-vision signer",
  FILM: "e.g. BSL Zone short film",
  ONLINE: "e.g. a Deaf vlogger on YouTube",
  DEAF_EVENT: "e.g. Deaf club social night",
  MET_DEAF: "e.g. coffee with a Deaf neighbour",
  OTHER: "What did you do?",
}

export type ReceptiveEntry = {
  id: string
  /** "YYYY-MM-DD" */
  date: string
  activity: ReceptiveActivity
  title: string
  minutes: number
  notes: string | null
}

export type ReceptiveTotals = {
  totalMinutes: number
  last7Minutes: number
  last30Minutes: number
  entries: number
  lastDate: string | null
}

export const MAX_MINUTES = 24 * 60
export const MAX_TITLE = 200
export const MAX_NOTES = 2000

/** Today in the UK, "YYYY-MM-DD". */
export const ukToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)

/** "YYYY-MM-DD" n days before `day`. */
export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h". */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Totals from entries; the 7 and 30 day windows include today. */
export function totalsOf(entries: Array<{ date: string; minutes: number }>, today = ukToday()): ReceptiveTotals {
  const from7 = daysBefore(today, 6)
  const from30 = daysBefore(today, 29)
  let totalMinutes = 0, last7Minutes = 0, last30Minutes = 0
  let lastDate: string | null = null
  for (const e of entries) {
    totalMinutes += e.minutes
    if (e.date >= from7 && e.date <= today) last7Minutes += e.minutes
    if (e.date >= from30 && e.date <= today) last30Minutes += e.minutes
    if (!lastDate || e.date > lastDate) lastDate = e.date
  }
  return { totalMinutes, last7Minutes, last30Minutes, entries: entries.length, lastDate }
}

export type ReceptiveInput = { date: string; activity: ReceptiveActivity; title: string; minutes: number; notes: string | null }

/** Checks a body from the student; returns the clean entry or a message to show them. */
export function parseReceptiveInput(body: unknown, today = ukToday()): ReceptiveInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const date = typeof b.date === "string" ? b.date : ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { error: "Choose the day it happened" }
  }
  if (date > today) return { error: "The date can't be in the future" }
  if (date < "2000-01-01") return { error: "Check the date" }

  const activity = b.activity as ReceptiveActivity
  if (!RECEPTIVE_ACTIVITIES.includes(activity)) return { error: "Choose what kind of activity it was" }

  const title = typeof b.title === "string" ? b.title.trim() : ""
  if (!title) return { error: "Say what you watched or who you met" }
  if (title.length > MAX_TITLE) return { error: `Keep the description under ${MAX_TITLE} characters` }

  const minutes = typeof b.minutes === "number" ? Math.round(b.minutes) : NaN
  if (!Number.isFinite(minutes) || minutes < 1) return { error: "Enter how long it was" }
  if (minutes > MAX_MINUTES) return { error: "That's more than a day — check the time" }

  const rawNotes = typeof b.notes === "string" ? b.notes.trim() : ""
  if (rawNotes.length > MAX_NOTES) return { error: `Keep your notes under ${MAX_NOTES} characters` }

  return { date, activity, title, minutes, notes: rawNotes || null }
}

/** CSV of entries for teachers who still want a spreadsheet. */
export function receptiveCsv(entries: ReceptiveEntry[]): string {
  const cell = (v: string | number) => {
    const s = String(v)
    // Quote everything that needs it, and stop spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const rows = [["Date", "Activity", "What / who", "Minutes", "Hours", "Notes"]]
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([e.date, ACTIVITY_LABEL[e.activity], e.title, String(e.minutes), (e.minutes / 60).toFixed(2), e.notes ?? ""])
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n")
}
