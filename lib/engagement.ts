// How engaged a student is, from when they were last on the platform and when
// they last actually did some learning. Pure — shared by the API routes and the
// staff pages, so the badges and the filters always agree.

export type Engagement =
  | "studying"   // did some learning in the last STUDY_WINDOW_DAYS
  | "browsing"   // signed in / on the platform lately, but no learning
  | "inactive"   // not on the platform for STUDY_WINDOW_DAYS or more
  | "never"      // has never signed in

export const STUDY_WINDOW_DAYS = 7
/** lastActiveAt is written at most every 2 minutes; 5 leaves room for that. */
export const ONLINE_WITHIN_MS = 5 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

type Dateish = Date | string | null | undefined

const time = (d: Dateish) => (d ? new Date(d).getTime() : null)

export function latest(...dates: Dateish[]): Date | null {
  const times = dates.map(time).filter((t): t is number => t !== null)
  return times.length ? new Date(Math.max(...times)) : null
}

export function engagementOf(
  a: { lastSeenAt: Dateish; lastStudiedAt: Dateish },
  now: number = Date.now(),
): Engagement {
  const studied = time(a.lastStudiedAt)
  const seen = time(latest(a.lastSeenAt, a.lastStudiedAt))
  if (studied !== null && now - studied < STUDY_WINDOW_DAYS * DAY_MS) return "studying"
  if (seen === null) return "never"
  if (now - seen < STUDY_WINDOW_DAYS * DAY_MS) return "browsing"
  return "inactive"
}

export function isOnline(lastActiveAt: Dateish, now: number = Date.now()): boolean {
  const t = time(lastActiveAt)
  return t !== null && now - t < ONLINE_WITHIN_MS
}

export const ENGAGEMENT_LOOK: Record<Engagement, { label: string; hint: string; className: string; dot: string }> = {
  studying: {
    label: "Studying",
    hint: `Did some learning in the last ${STUDY_WINDOW_DAYS} days`,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    dot: "bg-emerald-500",
  },
  browsing: {
    label: "Signing in, not studying",
    hint: `On the platform in the last ${STUDY_WINDOW_DAYS} days, but no lessons, tests or classes`,
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    dot: "bg-amber-500",
  },
  inactive: {
    label: "Inactive",
    hint: `Not on the platform for ${STUDY_WINDOW_DAYS} days or more`,
    className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    dot: "bg-red-500",
  },
  never: {
    label: "Never signed in",
    hint: "Has an account but has never used the platform",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/50",
  },
}

/** "Today", "Yesterday", "5 days ago", "Never". */
export function agoLabel(d: Dateish, now: number = Date.now()): string {
  const t = time(d)
  if (t === null) return "Never"
  const mins = Math.floor((now - t) / 60000)
  if (mins < 5) return "Just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? "Yesterday" : `${days} days ago`
}

export const CLIENT_LABEL: Record<string, string> = {
  web: "Website",
  "ios-app": "iPhone app",
  "android-app": "Android app",
  "mobile-app": "Phone app",
}

export const LOGIN_METHOD_LABEL: Record<string, string> = {
  PASSWORD: "Password",
  GOOGLE: "Google",
  REGISTER: "New account",
}

export const FAILURE_LABEL: Record<string, string> = {
  "unknown-email": "No account with this email",
  "wrong-password": "Wrong password",
  "google-only-account": "Tried a password on a Google account",
}

/** A short browser / device name from a user agent, for the login history. */
export function deviceOf(userAgent: string | null | undefined, client: string): string {
  if (client !== "web") return CLIENT_LABEL[client] ?? client
  const ua = userAgent ?? ""
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux"
    : null
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null
  if (!os && !browser) return "Browser"
  return [browser, os].filter(Boolean).join(" on ")
}
