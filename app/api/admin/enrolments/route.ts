import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope } from "@/lib/permissions"
import { createNotification, createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { onStudentRemovedFromCourse } from "@/lib/course-groups"

/**
 * Staff-side enrolment: putting students onto a course rather than waiting for
 * them to enrol themselves. Used by the Support Team desk, where office staff
 * book people onto classes on the phone.
 */

/**
 * The course, if this caller may manage who is on it. Staff manage any course;
 * a tutor holds `enrolments.manage` too, but only for the courses they teach.
 */
async function findManagedCourse(session: { role: string; sub: string }, id: string) {
  return prisma.course.findFirst({
    where: { id, ...courseTeachScope(session) },
    select: { id: true, title: true, tutorId: true },
  })
}

// GET /api/admin/enrolments?courseId=… — who is on this course
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const courseId = req.nextUrl.searchParams.get("courseId")?.trim()
    if (!courseId) return NextResponse.json({ message: "courseId is required" }, { status: 400 })

    const course = await findManagedCourse(session, courseId)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const enrolments = await prisma.enrollment.findMany({
      where: { courseId },
      orderBy: { enrolledAt: "desc" },
      include: {
        student: { select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true } },
      },
    })

    return NextResponse.json({
      enrolments: enrolments.map((e) => ({
        id: e.id,
        enrolledAt: e.enrolledAt.toISOString(),
        student: e.student,
      })),
      total: enrolments.length,
    })
  } catch (err) {
    console.error("[GET /api/admin/enrolments]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/admin/enrolments — { courseId, studentIds: [...] }
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { courseId, studentIds } = await req.json() as {
      courseId?: string
      studentIds?: string[]
    }
    if (!courseId) return NextResponse.json({ message: "courseId is required" }, { status: 400 })
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "Select at least one student" }, { status: 400 })
    }

    const course = await findManagedCourse(session, courseId)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Only real students, and only ones not already on the course.
    const students = await prisma.user.findMany({
      where: { id: { in: [...new Set(studentIds)] }, role: "STUDENT" },
      select: { id: true },
    })
    const alreadyOn = await prisma.enrollment.findMany({
      where: { courseId, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    })
    const skip = new Set(alreadyOn.map((e) => e.studentId))
    const toAdd = students.map((s) => s.id).filter((id) => !skip.has(id))

    if (toAdd.length === 0) {
      return NextResponse.json({ added: 0, skipped: skip.size, message: "Already enrolled" })
    }

    await prisma.enrollment.createMany({
      data: toAdd.map((studentId) => ({ studentId, courseId })),
      skipDuplicates: true,
    })

    void createNotifications(
      toAdd,
      "NEW_ENROLLMENT",
      "You've been added to a course",
      `${session.name} enrolled you in "${course.title}"`,
      `/student/lessons?courseId=${courseId}`,
    )
    void createNotification(
      course.tutorId,
      "NEW_ENROLLMENT",
      "Students added to your course",
      `${session.name} enrolled ${toAdd.length} student${toAdd.length === 1 ? "" : "s"} in "${course.title}"`,
      `/tutor/courses/${courseId}`,
    )

    return NextResponse.json({ added: toAdd.length, skipped: skip.size }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/admin/enrolments]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/admin/enrolments?courseId=…&studentId=…
async function handleDELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const courseId = req.nextUrl.searchParams.get("courseId")?.trim()
    const studentId = req.nextUrl.searchParams.get("studentId")?.trim()
    if (!courseId || !studentId) {
      return NextResponse.json({ message: "courseId and studentId are required" }, { status: 400 })
    }

    const course = await findManagedCourse(session, courseId)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const enrolment = await prisma.enrollment.findFirst({ where: { courseId, studentId } })
    if (!enrolment) return NextResponse.json({ message: "Enrolment not found" }, { status: 404 })

    await prisma.enrollment.delete({ where: { id: enrolment.id } })
    await onStudentRemovedFromCourse(courseId, studentId)
    return NextResponse.json({ message: "Student removed from the course" })
  } catch (err) {
    console.error("[DELETE /api/admin/enrolments]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
