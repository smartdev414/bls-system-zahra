import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { newOrder, signQuestionsForStudent } from "@/lib/quiz"
import { isLeagueOpen, LEAGUE_WORDS_PER_GO } from "@/lib/leagues"
import { signLeagueGo } from "@/lib/league-server"

// POST /api/student/leagues/[id]/start
// Starts a go: up to LEAGUE_WORDS_PER_GO of the league's words, picked at
// random and in a random order, and the ticket to send back with the answers
// (see signLeagueGo). The clock starts now, on the server.
async function handlePOST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const league = await prisma.league.findUnique({
      where: { id },
      select: {
        endsAt: true,
        test: {
          select: {
            questions: { where: READY_QUESTION, select: { id: true, question: true, imageUrl: true, mediaType: true } },
          },
        },
        members: { where: { userId: session.sub }, select: { id: true } },
      },
    })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })
    if (league.members.length === 0) return NextResponse.json({ message: "Join the league to play" }, { status: 403 })
    if (!isLeagueOpen(league)) return NextResponse.json({ message: "This league has finished" }, { status: 409 })

    const words = newOrder(league.test?.questions ?? []).slice(0, LEAGUE_WORDS_PER_GO)
    if (words.length === 0) return NextResponse.json({ message: "This league has no words yet" }, { status: 409 })

    const go = await signLeagueGo({ leagueId: id, userId: session.sub, wordIds: words.map((w) => w.id) })
    return NextResponse.json({
      go,
      // The videos only — the words themselves are never sent.
      questions: signQuestionsForStudent({ testKind: "FINGERSPELLING" }, words, false, false),
    })
  } catch (err) {
    console.error("[POST /api/student/leagues/[id]/start]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
