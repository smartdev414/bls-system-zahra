import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, isStaff, ownerScope } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const courses = await prisma.course.findMany({
      where: { ...ownerScope(session) },
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
    }

    const { title, description, level, categoryId, thumbnailUrl } = body

    if (!title?.trim() || !description?.trim()) {
      return NextResponse.json({ message: "Title and description are required" }, { status: 400 })
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

    // Generate unique slug
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    let slug = baseSlug
    let attempt = 0
    while (await prisma.course.findFirst({ where: { slug } })) {
      attempt++
      slug = `${baseSlug}-${attempt}`
    }

    const course = await prisma.course.create({
      data: {
        tutorId: ownerId,
        title: title.trim(),
        slug,
        description: description.trim(),
        level,
        categoryId: categoryId ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
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
