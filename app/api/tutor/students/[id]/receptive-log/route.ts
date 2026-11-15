import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { canViewStudent } from "@/lib/student-activity"
import { receptiveLogOf } from "@/lib/receptive-log-server"

// GET /api/tutor/students/:id/receptive-log — one student's receptive log
// (read-only). Tutors see their own students; staff see all.
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    if (!(await canViewStudent(session, id))) {
      return NextResponse.json({ message: "Student not found" }, { status: 404 })
    }
    return NextResponse.json(await receptiveLogOf(id))
  } catch (err) {
    console.error("[GET /api/tutor/students/:id/receptive-log]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
