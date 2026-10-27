import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"

// Fingerspelling leagues on the server — the rules shared with the screens are
// in lib/leagues.ts.

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
      select: { userId: true, score: true, correct: true, total: true, durationMs: true, user: { select: { name: true } } },
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
    }))
}
