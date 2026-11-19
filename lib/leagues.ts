/**
 * Fingerspelling leagues — competitions any student can choose to join,
 * whatever their level or courses. A league's words are a fingerspelling test
 * from the test bank; its difficulty sets how the words are played, so a
 * teacher only picks Easy, Medium or Hard. Students play as often as they
 * like: their best go ranks them, the quicker one when two are level.
 *
 * Unlike a course test, the words that were missed are never shown — the
 * league can be played again and again, so showing them would hand it over.
 */

export const LEAGUE_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const
export type LeagueDifficulty = (typeof LEAGUE_DIFFICULTIES)[number]

export const DIFFICULTY_INFO: Record<LeagueDifficulty, {
  label: string
  /** Seconds to type each word, once it has been shown. */
  answerSeconds: number
  /** How often each word plays; null = it repeats until the time is up. */
  signPlays: number | null
  /** What it means, for the student. */
  rules: string
  badge: string
}> = {
  EASY: {
    label: "Easy",
    answerSeconds: 10,
    signPlays: null,
    rules: "Each word repeats, and you have 10 seconds to type it.",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  MEDIUM: {
    label: "Medium",
    answerSeconds: 10,
    signPlays: 2,
    rules: "Each word is shown twice, then you have 10 seconds to type it.",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
  },
  HARD: {
    label: "Hard",
    answerSeconds: 5,
    signPlays: 1,
    rules: "Each word is shown once only, then you have 5 seconds to type it.",
    badge: "bg-rose-100 text-rose-700 border-rose-200",
  },
}

/**
 * Words played in one go, picked at random from the league's test, so the
 * same few words can't simply be learned by heart from go to go.
 */
export const LEAGUE_WORDS_PER_GO = 10

/** The 3, 2, 1 before the first word (GetReady), left out of the time. */
export const LEAGUE_GET_READY_MS = 3 * 800

/**
 * No one can watch a word being fingerspelled and type it in under this. A go
 * quicker than this per word still scores, but its time does not count.
 */
export const LEAGUE_MIN_MS_PER_WORD = 1000

export function parseDifficulty(value: unknown): LeagueDifficulty | null {
  return LEAGUE_DIFFICULTIES.includes(value as LeagueDifficulty) ? (value as LeagueDifficulty) : null
}

/** Whether goes still count: before its end date, or it has none. */
export function isLeagueOpen(league: { endsAt: Date | null }, now = new Date()): boolean {
  return league.endsAt === null || league.endsAt > now
}

/**
 * Reads an end date sent by a form ("2026-11-30"): the league runs to the end
 * of that day. Null when none was given; undefined when it is not a date.
 */
export function parseEndsAt(value: unknown): Date | null | undefined {
  if (value === null || value === "" || value === undefined) return null
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T23:59:59.999Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** "Aisha K." — enough for other students to know each other by. */
export function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/)
  const last = rest[rest.length - 1]
  return last ? `${first} ${last[0].toUpperCase()}.` : first
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`
}
