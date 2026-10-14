import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { urlsHiddenFromStudents } from "@/lib/background-clean"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // The sign dictionary is teaching material — office staff don't get it.
    if (!can(session.role, "dictionary.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const category = req.nextUrl.searchParams.get("category")?.trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 24
    const skip = (page - 1) * limit

    const isStudent = session.role === "STUDENT"

    const where = {
      ...(q ? {
        OR: [
          { word: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { category: { contains: q, mode: "insensitive" as const } },
        ],
      } : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" as const } } : {}),
      // A sign whose level is hidden from students doesn't turn up under a level filter either.
      ...(level ? { level: level as import("@/app/generated/prisma/client").CourseLevel, ...(isStudent && { showLevel: true }) } : {}),
    }

    const [total, signs, allCategories] = await Promise.all([
      prisma.sign.count({ where }),
      prisma.sign.findMany({
        where,
        orderBy: [{ category: "asc" }, { word: "asc" }],
        take: limit,
        skip,
      }),
      prisma.sign.findMany({
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      }),
    ])

    // Students don't get a sign's video while its background is still being
    // replaced (lib/background-clean.ts); the sign itself still shows.
    const hiddenUrls = isStudent
      ? await urlsHiddenFromStudents(signs.map((sign) => sign.videoUrl))
      : new Set<string>()

    // Details the admin unticked are blanked for students. The level stays (it is
    // required), so showLevel says whether this viewer's page should display it.
    return NextResponse.json({
      signs: signs.map((sign) => ({
        ...sign,
        showLevel: !isStudent || sign.showLevel,
        ...(sign.videoUrl && hiddenUrls.has(sign.videoUrl) && { videoUrl: null }),
        ...(isStudent && !sign.showHandshape && { handshape: "" }),
        ...(isStudent && !sign.showUsage && { usage: "" }),
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      categories: allCategories.map((c) => c.category),
    })
  } catch (err) {
    console.error("[GET /api/dictionary]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
