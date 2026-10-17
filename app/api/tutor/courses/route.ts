import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope, isStaff } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { cleanVenue, isCourseFormat, type CourseFormat } from "@/lib/course-format"
import { uniqueCourseSlug } from "@/lib/course-slug"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const courses = await prisma.course.findMany({
      // A tutor's courses are the ones they lead or have been put on as a teacher.
      where: { ...courseTeachScope(session) },
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { enrollments: true, sections: true } },
        sections: {
          include: {
            _count: { select: { lessons: true } },
          },
        },
      },
    })

    return NextResponse.json({
      courses: courses.map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        status: c.status,
        level: c.level,
        category: c.category,
        enrollmentCount: c._count.enrollments,
        sectionCount: c._count.sections,
        lessonCount: c.sections.reduce((sum, s) => sum + s._count.lessons, 0),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.create")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as {
      title: string
      description: string
      level: import("@/app/generated/prisma/client").CourseLevel
      categoryId?: string
      thumbnailUrl?: string
      /** Staff only — the tutor who will run the course. Optional. */
      tutorId?: string
      format?: CourseFormat
      /** Where a face-to-face course meets. */
      venue?: string
    }

    const { title, description, level, categoryId, thumbnailUrl } = body

    if (!title?.trim() || !description?.trim()) {
      return NextResponse.json({ message: "Title and description are required" }, { status: 400 })
    }
    const format = body.format ?? "ONLINE"
    if (!isCourseFormat(format)) {
      return NextResponse.json({ message: "format must be ONLINE or IN_PERSON" }, { status: 400 })
    }

    // Tutors own what they create. Staff may hand the course to a named tutor;
    // without one it stays with the staff member who created it.
    let ownerId = session.sub
    if (isStaff(session.role) && body.tutorId) {
      const tutor = await prisma.user.findFirst({
        where: { id: body.tutorId, role: "TUTOR" },
        select: { id: true },
      })
      if (!tutor) return NextResponse.json({ message: "Tutor not found" }, { status: 400 })
      ownerId = tutor.id
    }

    const slug = await uniqueCourseSlug(title)

    const course = await prisma.course.create({
      data: {
        tutorId: ownerId,
        title: title.trim(),
        slug,
        description: description.trim(),
        level,
        categoryId: categoryId ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        format,
        venue: format === "IN_PERSON" ? cleanVenue(body.venue) : null,
        status: "DRAFT",
      },
    })

    return NextResponse.json({ course }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
