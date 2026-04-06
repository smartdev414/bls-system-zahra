import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const category = req.nextUrl.searchParams.get("category")?.trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 20
    const skip = (page - 1) * limit

    const where = {
      ...(q ? {
        OR: [
          { word: { contains: q, mode: "insensitive" as const } },
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
    console.error("[GET /api/admin/signs]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
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

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
