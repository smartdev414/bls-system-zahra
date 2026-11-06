import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { courseRoster } from "@/lib/course-roster"
import { giveTrophies } from "@/lib/trophies"

/**
 * A teacher gives students a trophy for their hard work on the course. Students
 * who finish everything get one automatically (lib/trophies.ts); this is for
 * anyone else the teacher wants to praise.
 */

// POST /api/tutor/courses/[id]/students/trophy — { studentIds: [...] }
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds } = await req.json().catch(() => ({})) as { studentIds?: string[] }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "Select at least one student" }, { status: 400 })
    }

    const course = await prisma.course.findFirst({
      where: { id, ...courseTeachScope(session) },
      select: { id: true, title: true },
    })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Only students who are on the course.
    const wanted = new Set(studentIds)
    const roster = await courseRoster(id)
    const students = roster.students.filter((s) => wanted.has(s.id))
    if (students.length === 0) return NextResponse.json({ message: "Those students are not on this course" }, { status: 400 })

    const result = await giveTrophies(course, students, { id: session.sub, name: session.name })
    return NextResponse.json(result, { status: result.given > 0 ? 201 : 200 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/students/trophy]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
