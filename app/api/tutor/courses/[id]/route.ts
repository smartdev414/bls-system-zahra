import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotifications } from "@/lib/notifications"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const course = await prisma.course.findFirst({
      where: { id, tutorId: session.sub },
      include: {
        category: true,
        sections: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              include: { assets: { orderBy: { order: "asc" } } },
            },
          },
        },
        _count: { select: { enrollments: true } },
      },
    })

    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    return NextResponse.json({ course })
  } catch (err) {
    console.error("[GET /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as {
      title?: string
      description?: string
      level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      categoryId?: string | null
      thumbnailUrl?: string | null
    }

    // Verify ownership
    const existing = await prisma.course.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const course = await prisma.course.update({
      where: { id },
      data: {
        ...(body.title && { title: body.title.trim() }),
        ...(body.description && { description: body.description.trim() }),
        ...(body.level && { level: body.level }),
        ...(body.status && { status: body.status }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.thumbnailUrl !== undefined && { thumbnailUrl: body.thumbnailUrl }),
      },
    })

    // When a course is published for the first time, notify enrolled students
    if (body.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId: id },
        select: { studentId: true },
      })
      const studentIds = enrollments.map((e) => e.studentId)
      void createNotifications(
        studentIds,
        "COURSE_PUBLISHED",
        "Course is now available",
        `"${course.title}" has been published — start learning now!`,
        `/student/courses/${id}`,
      )
    }

    return NextResponse.json({ course })
  } catch (err) {
    console.error("[PUT /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.course.findFirst({ where: { id, tutorId: session.sub } })
    if (!existing) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    await prisma.course.delete({ where: { id } })
    return NextResponse.json({ message: "Course deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
