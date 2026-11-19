import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requestedToFilm } from "@/lib/sign-requests"
import { levelFromQuery } from "@/lib/levels"

const PAGE_SIZE = 50

// The signs still waiting for a video, in word order, for the recording page.
// Paged by `after` (the last word already loaded) rather than by page number:
// signs leave this list as their videos are saved, which would shift numbered
// pages under the person recording.
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const category = req.nextUrl.searchParams.get("category")?.trim() ?? ""
    const level = levelFromQuery(req.nextUrl.searchParams.get("level"))
    const after = req.nextUrl.searchParams.get("after") ?? ""

    const where = {
      videoUrl: null,
      ...(category ? { category: { equals: category, mode: "insensitive" as const } } : {}),
      ...(level ? { level: level as import("@/app/generated/prisma/client").CourseLevel } : {}),
    }

    // Words students asked for go first, with who asked and why. Only on the
    // unfiltered list: a request has no category or level yet.
    const requested = !category && !level ? await requestedToFilm() : []
    const requestedSignIds = requested.flatMap((r) => (r.id.startsWith("request:") ? [] : [r.id]))

    const [remaining, signs, allCategories] = await Promise.all([
      prisma.sign.count({ where }),
      prisma.sign.findMany({
        where: {
          ...where,
          ...(after ? { word: { gt: after } } : {}),
          ...(requestedSignIds.length ? { id: { notIn: requestedSignIds } } : {}),
        },
        orderBy: { word: "asc" },
        take: PAGE_SIZE + 1,
        select: { id: true, word: true, category: true, level: true, description: true },
      }),
      prisma.sign.findMany({
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      }),
    ])

    return NextResponse.json({
      requested: after ? [] : requested,
      signs: signs.slice(0, PAGE_SIZE),
      hasMore: signs.length > PAGE_SIZE,
      remaining: remaining + requested.length - requestedSignIds.length,
      categories: allCategories.map((c) => c.category),
    })
  } catch (err) {
    console.error("[GET /api/admin/signs/record-queue]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
