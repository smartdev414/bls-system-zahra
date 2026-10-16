import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { isCourseVisibility, type CourseVisibility } from "@/lib/course-visibility"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.view")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const status = req.nextUrl.searchParams.get("status")?.toUpperCase()
    const q = req.nextUrl.searchParams.get("q")?.trim()
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 20
    const skip = (page - 1) * limit

    const where = {
      ...(status ? { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    }

    const [total, courses] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        include: {
          tutor: { select: { id: true, name: true } },
          teachers: {
            orderBy: { assignedAt: "asc" },
            select: { tutor: { select: { id: true, name: true } } },
          },
          category: { select: { id: true, name: true } },
          _count: { select: { enrollments: true, sections: true } },
          reviews: { select: { rating: true } },
        },
      }),
    ])

    return NextResponse.json({
      courses: courses.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        visibility: c.visibility,
        level: c.level,
        tutor: c.tutor,
        teachers: c.teachers.map((t) => t.tutor),
        category: c.category,
        enrollmentCount: c._count.enrollments,
        sectionCount: c._count.sections,
        avgRating: c.reviews.length > 0
          ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
          : null,
        reviewCount: c.reviews.length,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error("[GET /api/admin/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.edit")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id, status, visibility, tutorId, categoryId } = await req.json() as {
      id: string
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      visibility?: CourseVisibility
      /** New lead teacher. */
      tutorId?: string
      /** null takes the course out of its category. */
      categoryId?: string | null
    }
    if (status !== undefined && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
      return NextResponse.json({ message: "status must be DRAFT, PUBLISHED or ARCHIVED" }, { status: 400 })
    }
    if (visibility !== undefined && !isCourseVisibility(visibility)) {
      return NextResponse.json({ message: "visibility must be PRIVATE or PUBLIC" }, { status: 400 })
    }
    if (tutorId !== undefined) {
      const tutor = await prisma.user.findFirst({ where: { id: tutorId, role: "TUTOR" }, select: { id: true } })
      if (!tutor) return NextResponse.json({ message: "Tutor not found" }, { status: 400 })
    }
    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } })
      if (!category) return NextResponse.json({ message: "Category not found" }, { status: 400 })
    }

    const course = await prisma.course.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(visibility && { visibility }),
        ...(tutorId && { tutorId }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
      },
    })
    // The lead is not also one of the course's extra teachers.
    if (tutorId) await prisma.courseTutor.deleteMany({ where: { courseId: id, tutorId } })

    return NextResponse.json({ course })
  } catch (err) {
    console.error("[PATCH /api/admin/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
