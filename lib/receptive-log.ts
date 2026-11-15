// Receptive log: time a student spends outside class watching and taking in
// signing (TV with signing, Deaf events, meeting Deaf people...). Shared by the
// student's own page, their teachers' view and the API. No server imports here.

export const RECEPTIVE_ACTIVITIES = ["TV", "FILM", "ONLINE", "DEAF_EVENT", "MET_DEAF", "PRACTICE", "OTHER"] as const
export type ReceptiveActivity = (typeof RECEPTIVE_ACTIVITIES)[number]

export const ACTIVITY_LABEL: Record<ReceptiveActivity, string> = {
  TV: "TV with signing",
  FILM: "Film or video in BSL",
  ONLINE: "Online / social media",
  DEAF_EVENT: "Deaf club or event",
  MET_DEAF: "Met Deaf people",
  PRACTICE: "Practice test / online course",
  OTHER: "Other",
}

/** Placeholders for "Name" and "Resource", per activity, in the style of the paper log. */
export const ACTIVITY_HINT: Record<ReceptiveActivity, { name: string; resource: string }> = {
  TV: { name: "e.g. See Hear - Episode 22", resource: "e.g. See Hear" },
  FILM: { name: "e.g. a BSL Zone short film", resource: "e.g. BSL Zone" },
  ONLINE: { name: "e.g. LUMO TV - Episode 21", resource: "e.g. YouTube" },
  DEAF_EVENT: { name: "e.g. Deaf club social night", resource: "e.g. local Deaf club" },
  MET_DEAF: { name: "e.g. coffee with a Deaf friend", resource: "e.g. in person" },
  PRACTICE: { name: "e.g. Practice test \u201cafternoon tea\u201d", resource: "e.g. Signature Learning Hub" },
  OTHER: { name: "What did you do?", resource: "Where?" },
}

export type ReceptiveEntry = {
  id: string
  /** "YYYY-MM-DD" */
  date: string
  activity: ReceptiveActivity
  title: string
  resource: string | null
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
export const MAX_RESOURCE = 120
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

export type ReceptiveInput = { date: string; activity: ReceptiveActivity; title: string; resource: string | null; minutes: number; notes: string | null }

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
  if (!title) return { error: "Give it a name: what you watched, or the event" }
  if (title.length > MAX_TITLE) return { error: `Keep the description under ${MAX_TITLE} characters` }

  const minutes = typeof b.minutes === "number" ? Math.round(b.minutes) : NaN
  if (!Number.isFinite(minutes) || minutes < 1) return { error: "Enter how long it was" }
  if (minutes > MAX_MINUTES) return { error: "That's more than a day — check the time" }

  const resource = typeof b.resource === "string" ? b.resource.trim() : ""
  if (resource.length > MAX_RESOURCE) return { error: `Keep the resource under ${MAX_RESOURCE} characters` }

  // The description is the evidence teachers look at, so it is required.
  const notes = typeof b.notes === "string" ? b.notes.trim() : ""
  if (!notes) return { error: "Add a content description: what it was about and any new vocabulary" }
  if (notes.length > MAX_NOTES) return { error: `Keep the description under ${MAX_NOTES} characters` }

  return { date, activity, title, resource: resource || null, minutes, notes }
}

/** "2026-09-14" → "14-Sep-26", as on the paper log. */
export const sheetDate = (day: string) => {
  const [y, m, d] = day.split("-")
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]
  return `${d}-${mon}-${y.slice(2)}`
}

/** CSV in the same columns as the paper log (plus the activity), for teachers who want the spreadsheet. */
export function receptiveCsv(entries: ReceptiveEntry[]): string {
  const cell = (v: string | number) => {
    const s = String(v)
    // Quote everything that needs it, and stop spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const rows = [["Name", "Date", "Hours", "Resource", "Activity", "Content description"]]
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([e.title, sheetDate(e.date), String(Math.round((e.minutes / 60) * 100) / 100), e.resource ?? "", ACTIVITY_LABEL[e.activity], e.notes ?? ""])
  }
  const total = entries.reduce((n, e) => n + e.minutes, 0)
  rows.push(["Total", "", String(Math.round((total / 60) * 100) / 100), "", "", ""])
  return rows.map((r) => r.map(cell).join(",")).join("\r\n")
}
