import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { createNotifications } from "@/lib/notifications"

/**
 * The teachers on a course.
 *
 * Staff put teachers on a course so they can see it, its lessons and its
 * students and take its classes. It grants no editing: course content stays
 * with admins.
 */

type RouteContext = { params: Promise<{ id: string }> }

const TEACHER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const

async function listTeachers(courseId: string) {
  const rows = await prisma.courseTutor.findMany({
    where: { courseId },
    orderBy: { assignedAt: "asc" },
    select: { tutor: { select: TEACHER_SELECT } },
  })
  return rows.map((r) => r.tutor)
}

// GET /api/admin/courses/[id]/tutors
async function handleGET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.edit")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const course = await prisma.course.findUnique({ where: { id }, select: { id: true } })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    return NextResponse.json({ teachers: await listTeachers(id) })
  } catch (err) {
    console.error("[GET /api/admin/courses/[id]/tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/admin/courses/[id]/tutors — { tutorIds: [...] } replaces the list
async function handlePUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "courses.edit")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { tutorIds } = await req.json() as { tutorIds?: string[] }
    if (!Array.isArray(tutorIds)) {
      return NextResponse.json({ message: "tutorIds must be an array" }, { status: 400 })
    }

    const course = await prisma.course.findUnique({ where: { id }, select: { id: true, tutorId: true, title: true } })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })
    const before = new Set((await listTeachers(id)).map((t) => t.id))

    // Only real tutors. The course's lead already has the same view, so listing
    // them again would just be a duplicate name.
    const tutors = await prisma.user.findMany({
      where: { id: { in: [...new Set(tutorIds)].filter((tid) => tid !== course.tutorId) }, role: "TUTOR" },
      select: { id: true },
    })
    const wanted = tutors.map((t) => t.id)

    await prisma.$transaction([
      prisma.courseTutor.deleteMany({ where: { courseId: id, tutorId: { notIn: wanted } } }),
      prisma.courseTutor.createMany({
        data: wanted.map((tutorId) => ({ courseId: id, tutorId })),
        skipDuplicates: true,
      }),
    ])

    // Only the teachers who are new to the course hear about it.
    void createNotifications(
      wanted.filter((tid) => !before.has(tid)),
      "COURSE_TEACHER_ADDED",
      "You've been added to a course",
      `${session.name} added you as a teacher on "${course.title}". You can now see its lessons and students and schedule its classes.`,
      `/tutor/courses/${id}`,
    )

    return NextResponse.json({ teachers: await listTeachers(id) })
  } catch (err) {
    console.error("[PUT /api/admin/courses/[id]/tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
