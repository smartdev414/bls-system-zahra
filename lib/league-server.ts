import { SignJWT, jwtVerify } from "jose"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { LEAGUE_GET_READY_MS, LEAGUE_MIN_MS_PER_WORD } from "@/lib/leagues"

// Fingerspelling leagues on the server — the rules shared with the screens are
// in lib/leagues.ts.

// ─── A go, timed by the server ────────────────────────────────────────────────
// Starting a go hands the student a signed ticket: the words picked for it and
// when it started. Their answers come back with it, so the server marks only
// those words and times the go itself — a time sent by the device could be
// anything. Its own key, so a ticket can never pass for a login token.
const GO_KEY = new TextEncoder().encode(
  `${process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"}:league-go`
)

export async function signLeagueGo(go: { leagueId: string; userId: string; wordIds: string[] }): Promise<string> {
  return new SignJWT({ lg: go.leagueId, w: go.wordIds, t: Date.now() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(go.userId)
    .setIssuedAt()
    .setExpirationTime("3h")
    .sign(GO_KEY)
}

/** The ticket's words and start, when it is this student's ticket for this league. */
export async function readLeagueGo(
  token: unknown, leagueId: string, userId: string,
): Promise<{ wordIds: string[]; startedAt: number } | null> {
  if (typeof token !== "string" || !token) return null
  try {
    const { payload } = await jwtVerify(token, GO_KEY)
    if (payload.lg !== leagueId || payload.sub !== userId) return null
    if (!Array.isArray(payload.w) || typeof payload.t !== "number") return null
    return { wordIds: payload.w.filter((w): w is string => typeof w === "string"), startedAt: payload.t }
  } catch {
    return null
  }
}

/**
 * How long the go took, from its start to now, less the 3, 2, 1. Null when it
 * is quicker than anyone could watch and type the words: the score stands,
 * but the time does not count.
 */
export function leagueGoTime(startedAt: number, words: number, now = Date.now()): number | null {
  const ms = now - startedAt - LEAGUE_GET_READY_MS
  if (ms < words * LEAGUE_MIN_MS_PER_WORD) return null
  return Math.min(ms, 24 * 60 * 60 * 1000)
}

/**
 * The words of a league must be a fingerspelling test with words in it.
 * Returns a message to answer 400 with when they are not.
 */
export async function checkLeagueWords(testId: unknown): Promise<string | null> {
  if (typeof testId !== "string" || !testId) return "Choose the words — a fingerspelling test"
  const test = await prisma.test.findUnique({
    where: { id: testId },
    select: { testKind: true, _count: { select: { questions: { where: READY_QUESTION } } } },
  })
  if (!test) return "That test no longer exists"
  if (test.testKind !== "FINGERSPELLING") return "Choose a fingerspelling test"
  if (test._count.questions === 0) return "That test has no filmed words yet — film some first"
  return null
}

export type Standing = {
  rank: number
  userId: string
  name: string
  score: number
  correct: number
  total: number
  durationMs: number | null
  goes: number
  /** They chose to keep their name and scores off other students' tables. */
  hidden: boolean
}

/**
 * A league's table: every member who has played, by their best go — the
 * higher score, then the quicker time, then whoever got there first.
 * Members who have not played yet are not on it.
 */
export async function leagueStandings(leagueId: string): Promise<Standing[]> {
  const [attempts, members] = await Promise.all([
    prisma.leagueAttempt.findMany({
      where: { leagueId },
      orderBy: [{ score: "desc" }, { durationMs: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { userId: true, score: true, correct: true, total: true, durationMs: true, user: { select: { name: true, hideFromLeagueTables: true } } },
    }),
    prisma.leagueMember.findMany({ where: { leagueId }, select: { userId: true } }),
  ])
  // Someone who left the league drops off its table; their goes are kept in
  // case they join again.
  const current = new Set(members.map((m) => m.userId))
  const goes = new Map<string, number>()
  for (const a of attempts) goes.set(a.userId, (goes.get(a.userId) ?? 0) + 1)

  const seen = new Set<string>()
  return attempts
    .filter((a) => current.has(a.userId) && !seen.has(a.userId) && seen.add(a.userId))
    .map((a, i) => ({
      rank: i + 1,
      userId: a.userId,
      name: a.user.name,
      score: a.score,
      correct: a.correct,
      total: a.total,
      durationMs: a.durationMs,
      goes: goes.get(a.userId) ?? 0,
      hidden: a.user.hideFromLeagueTables,
    }))
}

/**
 * The table as one student sees it: everyone else who keeps their scores
 * private is left out, and the places are counted again without them, so a
 * gap can't give them away. The student themselves is always on it, at their
 * place among those shown. Staff use leagueStandings, which has everyone.
 */
export function standingsForStudent(standings: Standing[], viewerId: string): Standing[] {
  return standings
    .filter((s) => !s.hidden || s.userId === viewerId)
    .map((s, i) => ({ ...s, rank: i + 1 }))
}
