import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { sameWord } from "@/lib/quiz"
import { isLeagueOpen } from "@/lib/leagues"
import { leagueStandings } from "@/lib/league-server"

// POST /api/student/leagues/[id]/attempt
// body: { answers: { questionId: string; text: string }[]; durationMs?: number }
// Marks a go at the league and says where it puts the student. Which words
// were right is not said — only how many.
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      select: {
        endsAt: true,
        test: { select: { questions: { where: READY_QUESTION, select: { id: true, question: true } } } },
        members: { where: { userId: session.sub }, select: { id: true } },
      },
    })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })
    if (league.members.length === 0) return NextResponse.json({ message: "Join the league to play" }, { status: 403 })
    if (!isLeagueOpen(league)) return NextResponse.json({ message: "This league has finished — your go did not count" }, { status: 409 })
    const words = league.test?.questions ?? []
    if (words.length === 0) return NextResponse.json({ message: "This league has no words yet" }, { status: 409 })

    const body = await req.json() as { answers?: Array<{ questionId?: unknown; text?: unknown }>; durationMs?: unknown }
    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      return NextResponse.json({ message: "answers are required" }, { status: 400 })
    }

    const given = new Map(body.answers.map((a) => [a.questionId, typeof a.text === "string" ? a.text.slice(0, 100) : ""]))
    const correct = words.filter((w) => sameWord(given.get(w.id), w.question)).length
    const total = words.length
    const score = Math.round((correct / total) * 100)
    const durationMs = Number.isFinite(body.durationMs) && Number(body.durationMs) > 0
      ? Math.min(Math.round(Number(body.durationMs)), 24 * 60 * 60 * 1000)
      : null

    const before = (await leagueStandings(id)).find((s) => s.userId === session.sub)
    await prisma.leagueAttempt.create({
      data: { leagueId: id, userId: session.sub, correct, total, score, durationMs },
    })
    const standings = await leagueStandings(id)
    const mine = standings.find((s) => s.userId === session.sub)!

    return NextResponse.json({
      correct, total, score, durationMs,
      rank: mine.rank,
      players: standings.length,
      // Their best so far — this go, unless an earlier one was better.
      personalBest: !before || mine.score !== before.score || mine.durationMs !== before.durationMs,
      firstGo: !before,
    })
  } catch (err) {
    console.error("[POST /api/student/leagues/[id]/attempt]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
