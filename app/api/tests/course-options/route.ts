import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { testCourseScope } from "@/lib/tests"

// GET /api/tests/course-options — the courses (with their sections) the caller
// can put a test in.
async function handleGET() {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const courses = await prisma.course.findMany({
      where: testCourseScope(session!),
      orderBy: [{ level: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        level: true,
        status: true,
        sections: { orderBy: { order: "asc" }, select: { id: true, title: true } },
      },
    })
    return NextResponse.json({ courses })
  } catch (err) {
    console.error("[GET /api/tests/course-options]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
