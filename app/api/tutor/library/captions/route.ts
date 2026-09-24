import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { PREPARED_CAPTION_LIMIT, TYPED_CAPTION_MAX } from "@/lib/library"

/**
 * The tutor's prepared captions: written in the library before class, sent into
 * the live classroom with one click. The list is edited as a whole (one caption
 * per line), so PUT replaces it.
 */

async function handleGET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const rows = await prisma.preparedCaption.findMany({
      where: { tutorId: session.sub },
      orderBy: { order: "asc" },
      select: { text: true },
    })
    return NextResponse.json({ captions: rows.map((r) => r.text) })
  } catch (err) {
    console.error("[GET /api/tutor/library/captions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as { captions?: unknown }
    if (!Array.isArray(body.captions)) {
      return NextResponse.json({ message: "captions must be a list" }, { status: 400 })
    }
    const captions = body.captions
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim().slice(0, TYPED_CAPTION_MAX))
      .filter(Boolean)
      .slice(0, PREPARED_CAPTION_LIMIT)

    await prisma.$transaction([
      prisma.preparedCaption.deleteMany({ where: { tutorId: session.sub } }),
      prisma.preparedCaption.createMany({
        data: captions.map((text, order) => ({ tutorId: session.sub, text, order })),
      }),
    ])

    return NextResponse.json({ captions })
  } catch (err) {
    console.error("[PUT /api/tutor/library/captions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
