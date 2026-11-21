import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { lessonEditScope } from "@/lib/tutor-access"

async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Admins, or a teacher with the "Lessons" switch on a course they teach.
    const scope = await lessonEditScope(session)
    if (!scope) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params
    const { lessonIds } = await req.json() as { lessonIds: string[] }
    if (!Array.isArray(lessonIds) || lessonIds.some((lessonId) => typeof lessonId !== "string")) {
      return NextResponse.json({ message: "lessonIds is required" }, { status: 400 })
    }

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId, course: scope },
      select: { lessons: { select: { id: true } } },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    // The list must be exactly this section's lessons, each once — otherwise a
    // stale page would leave two lessons sharing a number.
    const existing = new Set(section.lessons.map((l) => l.id))
    const sameLessons =
      lessonIds.length === existing.size &&
      new Set(lessonIds).size === lessonIds.length &&
      lessonIds.every((lessonId) => existing.has(lessonId))
    if (!sameLessons) {
      return NextResponse.json({ message: "Lessons have changed — reload and try again" }, { status: 409 })
    }

    // Renumber the whole section 1..n, which also closes any gaps left behind
    // by deleted lessons.
    await prisma.$transaction(
      lessonIds.map((lessonId, i) =>
        prisma.lesson.update({ where: { id: lessonId }, data: { order: i + 1 } })
      )
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[PUT /api/tutor/courses/[id]/sections/[sectionId]/reorder]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
