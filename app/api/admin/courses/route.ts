import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const status = req.nextUrl.searchParams.get("status")?.toUpperCase()
    const q = req.nextUrl.searchParams.get("q")?.trim()

    const courses = await prisma.course.findMany({
      where: {
        ...(status ? { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        tutor: { select: { id: true, name: true } },
        category: { select: { name: true } },
        _count: { select: { enrollments: true, sections: true } },
        reviews: { select: { rating: true } },
      },
    })

    return NextResponse.json({
      courses: courses.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        level: c.level,
        tutor: c.tutor,
        category: c.category,
        enrollmentCount: c._count.enrollments,
        sectionCount: c._count.sections,
        avgRating: c.reviews.length > 0
          ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
          : null,
        reviewCount: c.reviews.length,
        createdAt: c.createdAt.toISOString(),
      })),
      total: courses.length,
    })
  } catch (err) {
    console.error("[GET /api/admin/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id, status } = await req.json() as {
      id: string
      status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
    }

    const course = await prisma.course.update({
      where: { id },
      data: { status },
    })

    return NextResponse.json({ course })
  } catch (err) {
    console.error("[PATCH /api/admin/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
