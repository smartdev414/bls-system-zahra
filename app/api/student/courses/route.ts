import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 12
    const skip = (page - 1) * limit

    const where = {
      status: "PUBLISHED" as const,
      ...(q ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { tutor: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      } : {}),
      ...(level ? { level: level as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" } : {}),
    }

    const [total, courses, enrollments] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        include: {
          tutor: { select: { id: true, name: true, avatarUrl: true } },
          category: { select: { id: true, name: true } },
          reviews: { select: { rating: true } },
          _count: { select: { enrollments: true, sections: true } },
          sections: { include: { _count: { select: { lessons: true } } } },
        },
      }),
      prisma.enrollment.findMany({
        where: { studentId: session.sub },
        select: { courseId: true },
      }),
    ])

    const enrolledIds = new Set(enrollments.map((e) => e.courseId))

    return NextResponse.json({
      courses: courses.map((c) => {
        const lessonCount = c.sections.reduce((sum, s) => sum + s._count.lessons, 0)
        const avgRating = c.reviews.length > 0
          ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
          : null
        return {
          id: c.id,
          title: c.title,
          description: c.description,
          thumbnailUrl: c.thumbnailUrl,
          level: c.level,
          tutor: c.tutor,
          category: c.category,
          enrollmentCount: c._count.enrollments,
          sectionCount: c._count.sections,
          lessonCount,
          avgRating,
          reviewCount: c.reviews.length,
          isEnrolled: enrolledIds.has(c.id),
        }
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error("[GET /api/student/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
