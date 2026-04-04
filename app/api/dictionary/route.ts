import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const category = req.nextUrl.searchParams.get("category")?.trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 24
    const skip = (page - 1) * limit

    const where = {
      ...(q ? {
        OR: [
          { word: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { category: { contains: q, mode: "insensitive" as const } },
        ],
      } : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" as const } } : {}),
      ...(level ? { level: level as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" } : {}),
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

    return NextResponse.json({
      signs,
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
