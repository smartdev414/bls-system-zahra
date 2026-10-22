import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isLeagueOpen } from "@/lib/leagues"

type Params = { params: Promise<{ id: string }> }

// POST /api/student/leagues/[id]/membership — join. Any student can, whatever
// their level; joining twice is harmless.
async function handlePOST(_req: Request, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Only students can join a league" }, { status: 403 })

    const { id } = await params
    const league = await prisma.league.findUnique({ where: { id }, select: { endsAt: true } })
    if (!league) return NextResponse.json({ message: "League not found" }, { status: 404 })
    if (!isLeagueOpen(league)) return NextResponse.json({ message: "This league has finished" }, { status: 409 })

    await prisma.leagueMember.upsert({
      where: { leagueId_userId: { leagueId: id, userId: session.sub } },
      create: { leagueId: id, userId: session.sub },
      update: {},
    })
    return NextResponse.json({ joined: true })
  } catch (err) {
    console.error("[POST /api/student/leagues/[id]/membership]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/student/leagues/[id]/membership — leave. They drop off the
// table; their goes are kept, so joining again puts them back where they were.
async function handleDELETE(_req: Request, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    await prisma.leagueMember.deleteMany({ where: { leagueId: id, userId: session.sub } })
    return NextResponse.json({ joined: false })
  } catch (err) {
    console.error("[DELETE /api/student/leagues/[id]/membership]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
