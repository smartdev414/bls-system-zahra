import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { signQuestionsForStudent } from "@/lib/quiz"
import { DIFFICULTY_INFO, isLeagueOpen, shortName } from "@/lib/leagues"
import { leagueStandings } from "@/lib/league-server"

// GET /api/student/leagues/[id] — a league, its table (short names), and the
// words to play once the student has joined. The words themselves are never
// sent: the league can be played again and again.
async function handleGET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      select: {
        id: true, title: true, difficulty: true, endsAt: true, testId: true,
        _count: { select: { members: true } },
        members: { where: { userId: session.sub }, select: { id: true } },
      },
    })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })

    const joined = league.members.length > 0
    const open = isLeagueOpen(league)
    const [standings, words, myGoes] = await Promise.all([
      leagueStandings(id),
      league.testId
        ? prisma.quizQuestion.findMany({
            where: { testId: league.testId },
            orderBy: { order: "asc" },
            select: { id: true, question: true, imageUrl: true, mediaType: true },
          })
        : [],
      prisma.leagueAttempt.count({ where: { leagueId: id, userId: session.sub } }),
    ])
    const mine = standings.find((s) => s.userId === session.sub)
    const rules = DIFFICULTY_INFO[league.difficulty]

    return NextResponse.json({
      league: {
        id: league.id,
        title: league.title,
        difficulty: league.difficulty,
        endsAt: league.endsAt,
        open,
        joined,
        memberCount: league._count.members,
        wordCount: words.length,
        answerSeconds: rules.answerSeconds,
        signPlays: rules.signPlays,
      },
      // Only members play, and only while it runs.
      questions: joined && open ? signQuestionsForStudent("FINGERSPELLING", words, false) : [],
      standings: standings.map((s) => ({
        rank: s.rank,
        name: s.userId === session.sub ? "You" : shortName(s.name),
        score: s.score,
        durationMs: s.durationMs,
        isYou: s.userId === session.sub,
      })),
      me: { rank: mine?.rank ?? null, score: mine?.score ?? null, durationMs: mine?.durationMs ?? null, goes: myGoes },
    })
  } catch (err) {
    console.error("[GET /api/student/leagues/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
