import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// Sign categories are plain text on each sign, so there is no category table:
// the list is whatever the signs use, and changing one means moving its signs.

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const groups = await prisma.sign.groupBy({
      by: ["category"],
      _count: { _all: true },
      orderBy: { category: "asc" },
    })

    return NextResponse.json({
      categories: groups.map((g) => ({ name: g.category, count: g._count._all })),
    })
  } catch (err) {
    console.error("[GET /api/admin/signs/categories]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// Moves every sign in `from` to `to`. Used for renaming, for merging into an
// existing category, and for deleting one (its signs have to go somewhere).
async function handlePATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const body = await req.json() as { from?: string; to?: string }
    const from = body.from
    let to = body.to?.trim()
    if (!from) return NextResponse.json({ message: "Category is required" }, { status: 400 })
    if (!to) return NextResponse.json({ message: "New category name is required" }, { status: 400 })

    // Reuse an existing category's exact spelling so "cities" joins "Cities"
    // instead of creating a near-duplicate.
    const existing = await prisma.sign.findFirst({
      where: { category: { equals: to, mode: "insensitive" }, NOT: { category: from } },
      select: { category: true },
    })
    if (existing) to = existing.category

    const { count } = await prisma.sign.updateMany({
      where: { category: from },
      data: { category: to },
    })

    return NextResponse.json({ updated: count, to, merged: !!existing })
  } catch (err) {
    console.error("[PATCH /api/admin/signs/categories]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
