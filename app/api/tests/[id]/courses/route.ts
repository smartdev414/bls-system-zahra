import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { requireCapability } from "@/lib/permissions"
import { parseReleaseAt } from "@/lib/lesson-release"
import { placeTest, testCourseScope } from "@/lib/tests"

// POST /api/tests/[id]/courses — { courseId, sectionId, releaseAt? }
// Puts the test at the end of a section of a course the caller teaches. Any
// test in the bank can be used, not only the caller's own.
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await prisma.test.findUnique({
      where: { id },
      select: { id: true, title: true, description: true },
    })
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const body = await req.json() as { courseId?: string; sectionId?: string; releaseAt?: string | null }
    if (!body.courseId || !body.sectionId) {
      return NextResponse.json({ message: "Choose a course and a section" }, { status: 400 })
    }
    const releaseAt = parseReleaseAt(body.releaseAt ?? null)
    if (releaseAt === undefined) {
      return NextResponse.json({ message: "Release date is not a valid date" }, { status: 400 })
    }

    const section = await prisma.section.findFirst({
      where: { id: body.sectionId, courseId: body.courseId, course: testCourseScope(session!) },
      select: { id: true, course: { select: { id: true, title: true, status: true } } },
    })
    if (!section) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const lesson = await placeTest(test, section, releaseAt)
    return NextResponse.json({ lesson }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tests/[id]/courses]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(tutorWrite("tests", handlePOST))
