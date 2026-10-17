import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { studentVisibleCourses } from "@/lib/course-visibility"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""
    const tutorId = req.nextUrl.searchParams.get("tutorId")?.trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 12
    const skip = (page - 1) * limit

    // Public courses, and private ones the student is on — never other classes
    const visible = studentVisibleCourses(session.sub)
    const where = {
      AND: [
        visible,
        ...(q ? [{
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { tutor: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }] : []),
      ],
      ...(level ? { level: level as import("@/app/generated/prisma/client").CourseLevel } : {}),
      ...(tutorId ? { tutorId } : {}),
    }

    // Look up which tutor invited this student (if any)
    const student = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { invitedById: true, invitedBy: { select: { id: true, name: true, avatarUrl: true } } },
    })
    const invitingTutorId = student?.invitedById ?? null

    const courseInclude = {
      tutor: { select: { id: true, name: true, avatarUrl: true } },
      category: { select: { id: true, name: true } },
      reviews: { select: { rating: true } },
      _count: { select: { enrollments: true, sections: true } },
      // Every lesson counts, released or still locked: a course is not finished
      // until the whole term has been.
      sections: { include: { _count: { select: { lessons: true } } } },
    }

    const [total, courses, enrollments, rawRecommended] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        include: courseInclude,
      }),
      // Fetch enrollments with completed lesson counts
      prisma.enrollment.findMany({
        where: { studentId: session.sub },
        select: {
          courseId: true,
          completedAt: true,
          progress: {
            where: { isCompleted: true },
            select: { lessonId: true },
          },
        },
      }),
      // Fetch inviting tutor's courses (recommended) — only when applicable
      invitingTutorId
        ? prisma.course.findMany({
            where: { AND: [visible, { tutorId: invitingTutorId }] },
            orderBy: { createdAt: "desc" },
            include: courseInclude,
          })
        : Promise.resolve([]),
    ])

    const enrollmentMap = new Map(
      enrollments.map((e) => [e.courseId, { completedAt: e.completedAt, completedLessons: e.progress.length }])
    )

    function shapeCourse(c: typeof courses[number]) {
      const lessonCount = c.sections.reduce((sum, s) => sum + s._count.lessons, 0)
      const avgRating = c.reviews.length > 0
        ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
        : null
      const enrollment = enrollmentMap.get(c.id)
      const completedLessons = enrollment?.completedLessons ?? 0
      const completion = lessonCount > 0 ? Math.round((completedLessons / lessonCount) * 100) : 0
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        level: c.level,
        format: c.format,
        venue: c.venue,
        tutor: c.tutor,
        category: c.category,
        enrollmentCount: c._count.enrollments,
        sectionCount: c._count.sections,
        lessonCount,
        avgRating,
        reviewCount: c.reviews.length,
        isEnrolled: enrollmentMap.has(c.id),
        // A private course is the student's class: staff put them on it and
        // take them off it, so only a public course can be left.
        canLeave: c.visibility === "PUBLIC",
        progress: enrollment ? {
          completedLessons,
          totalLessons: lessonCount,
          completion,
          isCompleted: enrollment.completedAt !== null || completion >= 100,
        } : null,
      }
    }

    return NextResponse.json({
      courses: courses.map(shapeCourse),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      invitedByTutor: student?.invitedBy ?? null,
      recommendedCourses: rawRecommended.map(shapeCourse),
    })
  } catch (err) {
    console.error("[GET /api/student/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
