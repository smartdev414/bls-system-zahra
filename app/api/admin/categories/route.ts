import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { courses: true } } },
    })

    return NextResponse.json({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        courseCount: c._count.courses,
      })),
    })
  } catch (err) {
    console.error("[GET /api/admin/categories]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { name } = await req.json() as { name: string }
    if (!name?.trim()) return NextResponse.json({ message: "Name is required" }, { status: 400 })

    const slug = toSlug(name.trim())
    const category = await prisma.category.create({
      data: { name: name.trim(), slug },
    })

    return NextResponse.json({ category }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ message: "Category already exists" }, { status: 409 })
    }
    console.error("[POST /api/admin/categories]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
