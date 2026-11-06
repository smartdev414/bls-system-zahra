import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { courseRoster } from "@/lib/course-roster"
import { enrolStudents, onStudentRemovedFromCourse } from "@/lib/course-groups"

/**
 * The students on one course, managed from the course page itself.
 *
 * A tutor builds a course per class (Level 1, Level 2, …) and puts that class's
 * students on it — one by one or a whole saved group at once. Adding a group is
 * a one-time copy of its members: the course keeps its own list from then on,
 * so editing the group later never enrols or unenrols anybody behind the
 * tutor's back.
 */

type RouteContext = { params: Promise<{ id: string }> }

/** The course, if this caller may manage who is on it. Tutors: the ones they teach. */
async function findManagedCourse(session: { role: string; sub: string }, id: string) {
  return prisma.course.findFirst({
    where: { id, ...courseTeachScope(session) },
    select: { id: true, title: true, tutorId: true },
  })
}

// GET /api/tutor/courses/[id]/students — who is on this course
async function handleGET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    return NextResponse.json(await courseRoster(id))
  } catch (err) {
    console.error("[GET /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/tutor/courses/[id]/students — { studentIds: [...] }
async function handlePOST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds } = await req.json() as { studentIds?: string[] }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "Select at least one student" }, { status: 400 })
    }

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const { added, skipped } = await enrolStudents(course, studentIds, session)
    if (added.length === 0) return NextResponse.json({ added: 0, skipped })

    return NextResponse.json({ added: added.length, skipped }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tutor/courses/[id]/students?studentId=…
async function handleDELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const studentId = req.nextUrl.searchParams.get("studentId")?.trim()
    if (!studentId) return NextResponse.json({ message: "studentId is required" }, { status: 400 })

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Removing the enrolment cascades to the student's lesson progress.
    const { count } = await prisma.enrollment.deleteMany({ where: { courseId: id, studentId } })
    if (count === 0) return NextResponse.json({ message: "Student is not on this course" }, { status: 404 })
    await onStudentRemovedFromCourse(id, studentId)

    return NextResponse.json({ message: "Student removed from the course" })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(tutorWrite("students", handlePOST))
export const DELETE = withAudit(tutorWrite("students", handleDELETE))
