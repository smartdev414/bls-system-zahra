import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { canEditTest } from "@/lib/tests"
import { parseDifficulty, parseEndsAt } from "@/lib/leagues"
import { checkLeagueWords, leagueStandings } from "@/lib/league-server"

type Params = { params: Promise<{ id: string }> }

// GET /api/leagues/[id] — a league and its whole table, with full names.
async function handleGET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      select: {
        id: true, title: true, difficulty: true, endsAt: true, createdById: true, createdAt: true,
        createdBy: { select: { name: true } },
        test: { select: { id: true, title: true, _count: { select: { questions: { where: READY_QUESTION } } } } },
        members: { select: { userId: true, joinedAt: true, user: { select: { name: true } } }, orderBy: { joinedAt: "asc" } },
      },
    })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })

    const standings = await leagueStandings(id)
    const played = new Set(standings.map((s) => s.userId))
    const { test, members, createdBy, ...rest } = league

    return NextResponse.json({
      league: {
        ...rest,
        test: test && { id: test.id, title: test.title, wordCount: test._count.questions },
        memberCount: members.length,
        createdByName: createdBy?.name ?? null,
        canEdit: canEditTest(session!, league),
      },
      standings,
      // Joined, but no go yet.
      waiting: members.filter((m) => !played.has(m.userId)).map((m) => ({ userId: m.userId, name: m.user.name })),
    })
  } catch (err) {
    console.error("[GET /api/leagues/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/leagues/[id] — body: any of { title, difficulty, testId, endsAt: "YYYY-MM-DD" | null, end: true }
// `end` finishes it now; `endsAt: null` lets it run on again.
async function handlePATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const league = await prisma.league.findUnique({ where: { id }, select: { createdById: true } })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })
    if (!canEditTest(session!, league)) {
      return NextResponse.json({ message: "Only the teacher who made this league, or an admin, can change it" }, { status: 403 })
    }

    const body = await req.json() as { title?: unknown; difficulty?: unknown; testId?: unknown; endsAt?: unknown; end?: unknown }
    const data: { title?: string; difficulty?: "EASY" | "MEDIUM" | "HARD"; testId?: string; endsAt?: Date | null } = {}

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : ""
      if (!title) return NextResponse.json({ message: "Give the league a name" }, { status: 400 })
      data.title = title
    }
    if (body.difficulty !== undefined) {
      const difficulty = parseDifficulty(body.difficulty)
      if (!difficulty) return NextResponse.json({ message: "Choose Easy, Medium or Hard" }, { status: 400 })
      data.difficulty = difficulty
    }
    if (body.testId !== undefined) {
      const wrongWords = await checkLeagueWords(body.testId)
      if (wrongWords) return NextResponse.json({ message: wrongWords }, { status: 400 })
      data.testId = body.testId as string
    }
    if (body.end === true) {
      data.endsAt = new Date()
    } else if (body.endsAt !== undefined) {
      const endsAt = parseEndsAt(body.endsAt)
      if (endsAt === undefined) return NextResponse.json({ message: "That end date is not a date" }, { status: 400 })
      if (endsAt && endsAt <= new Date()) return NextResponse.json({ message: "The end date has already passed" }, { status: 400 })
      data.endsAt = endsAt
    }

    const updated = await prisma.league.update({ where: { id }, data })
    return NextResponse.json({ league: updated })
  } catch (err) {
    console.error("[PATCH /api/leagues/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/leagues/[id] — the league, its members and every go at it.
async function handleDELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const league = await prisma.league.findUnique({ where: { id }, select: { createdById: true } })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })
    if (!canEditTest(session!, league)) {
      return NextResponse.json({ message: "Only the teacher who made this league, or an admin, can delete it" }, { status: 403 })
    }

    await prisma.league.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/leagues/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
