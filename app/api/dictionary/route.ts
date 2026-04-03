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

    const signs = await prisma.sign.findMany({
      where: {
        ...(q ? {
          OR: [
            { word: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
        ...(level ? { level: level as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" } : {}),
      },
      orderBy: [{ category: "asc" }, { word: "asc" }],
    })

    const allCategories = await prisma.sign.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    })

    return NextResponse.json({
      signs,
      total: signs.length,
      categories: allCategories.map((c) => c.category),
    })
  } catch (err) {
    console.error("[GET /api/dictionary]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
