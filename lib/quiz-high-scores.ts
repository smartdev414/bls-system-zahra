import prisma from "@/lib/prisma"
import { HIGH_SCORES } from "@/lib/quiz"

export type HighScore = { name: string; score: number; durationMs: number | null; isYou: boolean }

/** "Aisha K." — enough for classmates to know each other by. */
function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/)
  const last = rest[rest.length - 1]
  return last ? `${first} ${last[0].toUpperCase()}.` : first
}

/**
 * The high scores of a test: each student once, by their best go — the higher
 * score, and the quicker one when two are level.
 */
export async function highScores(lessonId: string, viewerId: string): Promise<HighScore[]> {
  const attempts = await prisma.quizAttempt.findMany({
    where: { lessonId, user: { role: "STUDENT" } },
    orderBy: [{ score: "desc" }, { durationMs: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { userId: true, score: true, durationMs: true, user: { select: { name: true } } },
  })

  const seen = new Set<string>()
  const best = attempts.filter((a) => !seen.has(a.userId) && seen.add(a.userId))
  return best.slice(0, HIGH_SCORES).map((a) => ({
    name: shortName(a.user.name),
    score: a.score,
    durationMs: a.durationMs,
    isYou: a.userId === viewerId,
  }))
}
