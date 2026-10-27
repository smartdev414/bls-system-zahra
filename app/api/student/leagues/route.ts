import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { LEAGUE_DIFFICULTIES, isLeagueOpen, shortName } from "@/lib/leagues"
import { leagueStandings } from "@/lib/league-server"

// GET /api/student/leagues — every league, whatever the student's level: the
// running ones first (Easy → Hard), then the finished ones, newest first.
async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const leagues = await prisma.league.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, difficulty: true, endsAt: true,
        test: { select: { _count: { select: { questions: { where: READY_QUESTION } } } } },
        _count: { select: { members: true } },
        members: { where: { userId: session.sub }, select: { id: true } },
      },
    })

    const now = new Date()
    const rows = await Promise.all(leagues.map(async ({ test, _count, members, ...league }) => {
      const standings = await leagueStandings(league.id)
      const mine = standings.find((s) => s.userId === session.sub)
      const leader = standings[0]
      return {
        ...league,
        open: isLeagueOpen(league, now),
        wordCount: test?._count.questions ?? 0,
        memberCount: _count.members,
        joined: members.length > 0,
        myRank: mine?.rank ?? null,
        myScore: mine?.score ?? null,
        players: standings.length,
        leader: leader && { name: leader.userId === session.sub ? "You" : shortName(leader.name), score: leader.score },
      }
    }))

    rows.sort((a, b) =>
      Number(b.open) - Number(a.open)
      || (a.open ? LEAGUE_DIFFICULTIES.indexOf(a.difficulty) - LEAGUE_DIFFICULTIES.indexOf(b.difficulty) : 0))

    return NextResponse.json({ leagues: rows })
  } catch (err) {
    console.error("[GET /api/student/leagues]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
