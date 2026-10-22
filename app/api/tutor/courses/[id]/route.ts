import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { isCourseVisibility, type CourseVisibility } from "@/lib/course-visibility"
import { can, courseContentScope, courseTeachScope } from "@/lib/permissions"
import { deleteCourseAnswerVideos, scheduleAnswerVideoDeletion } from "@/lib/test-recordings"

async function handleGET(
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
      // Teachers open the courses they are on; only admins may change them.
      where: { id, ...courseTeachScope(session) },
      include: {
        category: true,
        tutor: { select: { id: true, name: true } },
        teachers: {
          orderBy: { assignedAt: "asc" },
          select: { tutor: { select: { id: true, name: true } } },
        },
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

    return NextResponse.json({
      course: { ...course, teachers: course.teachers.map((t) => t.tutor) },
      // Drives the page: without it the course is shown read-only.
      canEdit: can(session.role, "lessons.manage"),
    })
  } catch (err) {
    console.error("[GET /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as {
      title?: string
      description?: string
      level?: import("@/app/generated/prisma/client").CourseLevel
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      visibility?: CourseVisibility
      categoryId?: string | null
      thumbnailUrl?: string | null
    }

    if (body.visibility !== undefined && !isCourseVisibility(body.visibility)) {
      return NextResponse.json({ message: "visibility must be PRIVATE or PUBLIC" }, { status: 400 })
    }

    // Verify ownership
    const existing = await prisma.course.findFirst({ where: { id, ...courseContentScope(session) } })
    if (!existing) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const course = await prisma.course.update({
      where: { id },
      data: {
        ...(body.title && { title: body.title.trim() }),
        ...(body.description && { description: body.description.trim() }),
        ...(body.level && { level: body.level }),
        ...(body.status && { status: body.status }),
        ...(body.visibility && { visibility: body.visibility }),
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
        `/student/lessons?courseId=${id}`,
      )
    }

    // The course has finished: students' recordings in its tests are deleted a week from now.
    if (body.status === "ARCHIVED" && existing.status !== "ARCHIVED") await scheduleAnswerVideoDeletion(id)

    return NextResponse.json({ course })
  } catch (err) {
    console.error("[PUT /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.delete")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.course.findFirst({ where: { id, ...courseContentScope(session) } })
    if (!existing) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Students' recordings in its tests go first, while its lessons still say which they are.
    await deleteCourseAnswerVideos(id)

    // Classes that were held for the course stay in the timetable history
    // (with their attendance and recordings) — they just stop pointing at it.
    // Enrolments (with their lesson progress) and reviews go with the course.
    await prisma.$transaction([
      prisma.liveSession.updateMany({ where: { courseId: id }, data: { courseId: null } }),
      prisma.review.deleteMany({ where: { courseId: id } }),
      prisma.enrollment.deleteMany({ where: { courseId: id } }),
      prisma.course.delete({ where: { id } }),
    ])
    return NextResponse.json({ message: "Course deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
