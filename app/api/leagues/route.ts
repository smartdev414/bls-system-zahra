import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { canEditTest } from "@/lib/tests"
import { DIFFICULTY_INFO, LEAGUE_DIFFICULTIES, parseDifficulty, parseEndsAt } from "@/lib/leagues"
import { checkLeagueWords, leagueStandings } from "@/lib/league-server"

// GET /api/leagues — every league, Easy first, newest first within each.
async function handleGET() {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const leagues = await prisma.league.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, difficulty: true, endsAt: true, createdById: true, createdAt: true,
        createdBy: { select: { name: true } },
        test: { select: { id: true, title: true, _count: { select: { questions: true } } } },
        _count: { select: { members: true, attempts: true } },
      },
    })

    const rows = await Promise.all(leagues.map(async ({ test, _count, createdBy, ...league }) => {
      const [leader] = await leagueStandings(league.id)
      return {
        ...league,
        test: test && { id: test.id, title: test.title, wordCount: test._count.questions },
        memberCount: _count.members,
        goes: _count.attempts,
        leader: leader ? { name: leader.name, score: leader.score } : null,
        createdByName: createdBy?.name ?? null,
        canEdit: canEditTest(session!, league),
      }
    }))
    rows.sort((a, b) => LEAGUE_DIFFICULTIES.indexOf(a.difficulty) - LEAGUE_DIFFICULTIES.indexOf(b.difficulty))

    return NextResponse.json({ leagues: rows })
  } catch (err) {
    console.error("[GET /api/leagues]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/leagues — body: { difficulty, testId, title?, endsAt?: "YYYY-MM-DD" | null }
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const body = await req.json() as { title?: unknown; difficulty?: unknown; testId?: unknown; endsAt?: unknown }

    const difficulty = parseDifficulty(body.difficulty)
    if (!difficulty) return NextResponse.json({ message: "Choose Easy, Medium or Hard" }, { status: 400 })

    const wrongWords = await checkLeagueWords(body.testId)
    if (wrongWords) return NextResponse.json({ message: wrongWords }, { status: 400 })

    const endsAt = parseEndsAt(body.endsAt)
    if (endsAt === undefined) return NextResponse.json({ message: "That end date is not a date" }, { status: 400 })
    if (endsAt && endsAt <= new Date()) return NextResponse.json({ message: "The end date has already passed" }, { status: 400 })

    const title = (typeof body.title === "string" && body.title.trim().slice(0, 100))
      || `${DIFFICULTY_INFO[difficulty].label} fingerspelling league`

    const league = await prisma.league.create({
      data: { title, difficulty, testId: body.testId as string, endsAt, createdById: session!.sub },
    })
    return NextResponse.json({ league }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/leagues]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
