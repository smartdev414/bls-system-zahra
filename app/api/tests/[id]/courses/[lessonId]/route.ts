import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseTeachScope, requireCapability } from "@/lib/permissions"

// DELETE /api/tests/[id]/courses/[lessonId] — takes the test out of one course.
// The test stays in the bank; the results students had there go.
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id, lessonId } = await params
    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, testId: id, section: { course: courseTeachScope(session!) } },
      select: { id: true },
    })
    if (!lesson) return NextResponse.json({ message: "Not found" }, { status: 404 })

    await prisma.lesson.delete({ where: { id: lessonId } })
    return NextResponse.json({ message: "Taken out of the course" })
  } catch (err) {
    console.error("[DELETE /api/tests/[id]/courses/[lessonId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
