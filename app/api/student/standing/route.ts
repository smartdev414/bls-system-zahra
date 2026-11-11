import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { studentStanding } from "@/lib/student-standing"

// GET  /api/student/standing — how the student is doing on each running course
//      (faces per area) and whether the "you're falling behind" notice is due.
// POST /api/student/standing — { courseIds } the student pressed "I understand".

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    return NextResponse.json({ courses: await studentStanding(session.sub) })
  } catch (err) {
    console.error("[GET /api/student/standing]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { courseIds } = await req.json() as { courseIds?: unknown }
    if (!Array.isArray(courseIds) || courseIds.length === 0 || courseIds.some((c) => typeof c !== "string")) {
      return NextResponse.json({ message: "courseIds is required" }, { status: 400 })
    }
    await prisma.enrollment.updateMany({
      where: { studentId: session.sub, courseId: { in: courseIds as string[] } },
      data: { behindNoticeSeenAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[POST /api/student/standing]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
