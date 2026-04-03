import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const category = req.nextUrl.searchParams.get("category")?.trim() ?? ""

    const signs = await prisma.sign.findMany({
      where: {
        ...(q ? {
          OR: [
            { word: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      },
      orderBy: [{ category: "asc" }, { word: "asc" }],
    })

    const categories = await prisma.sign.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    })

    return NextResponse.json({
      signs,
      total: signs.length,
      categories: categories.map((c) => c.category),
    })
  } catch (err) {
    console.error("[GET /api/admin/signs]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const body = await req.json() as {
      word: string
      category: string
      level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
      description: string
      handshape: string
      usage: string
      videoUrl?: string | null
      imageUrl?: string | null
    }

    if (!body.word?.trim()) return NextResponse.json({ message: "Word is required" }, { status: 400 })
    if (!body.category?.trim()) return NextResponse.json({ message: "Category is required" }, { status: 400 })
    if (!body.description?.trim()) return NextResponse.json({ message: "Description is required" }, { status: 400 })
    if (!body.handshape?.trim()) return NextResponse.json({ message: "Handshape is required" }, { status: 400 })
    if (!body.usage?.trim()) return NextResponse.json({ message: "Usage is required" }, { status: 400 })

    const sign = await prisma.sign.create({
      data: {
        word: body.word.trim(),
        category: body.category.trim(),
        level: body.level ?? "BEGINNER",
        description: body.description.trim(),
        handshape: body.handshape.trim(),
        usage: body.usage.trim(),
        videoUrl: body.videoUrl?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
      },
    })

    return NextResponse.json({ sign }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ message: "A sign with this word already exists" }, { status: 409 })
    }
    console.error("[POST /api/admin/signs]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
