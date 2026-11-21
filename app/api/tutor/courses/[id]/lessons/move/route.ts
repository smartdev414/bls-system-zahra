import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { lessonEditScope } from "@/lib/tutor-access"

/**
 * Moves one lesson (or test) to a place in the course — later in its own
 * section, or into another one ("this test belongs on Day 6, not Day 9"). The
 * course page drags lessons here; nothing has to be deleted and uploaded again.
 *
 * Both sections are renumbered 1..n. A lesson moved into another section takes
 * that section's release date when every lesson there shares one (including
 * "open now"), so it opens with the rest of its new day rather than on the old
 * day's date. Progress, attempts and marks stay with the lesson.
 */
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Admins, or a teacher with the "Lessons" switch on a course they teach.
    const scope = await lessonEditScope(session)
    if (!scope) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId } = await params
    const body = await req.json() as { lessonId?: unknown; sectionId?: unknown; index?: unknown }
    if (typeof body.lessonId !== "string" || typeof body.sectionId !== "string" ||
        typeof body.index !== "number" || !Number.isInteger(body.index) || body.index < 0) {
      return NextResponse.json({ message: "lessonId, sectionId and index are required" }, { status: 400 })
    }
    const { lessonId, sectionId, index } = body as { lessonId: string; sectionId: string; index: number }

    const course = await prisma.course.findFirst({
      where: { id: courseId, ...scope },
      select: { id: true },
    })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const [lesson, target] = await Promise.all([
      prisma.lesson.findFirst({
        where: { id: lessonId, section: { courseId } },
        select: { id: true, sectionId: true, releaseAt: true },
      }),
      prisma.section.findFirst({
        where: { id: sectionId, courseId },
        select: { id: true, lessons: { orderBy: { order: "asc" }, select: { id: true, releaseAt: true } } },
      }),
    ])
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    if (!target) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    const moving = lesson.sectionId !== target.id
    const others = target.lessons.filter((l) => l.id !== lessonId)
    const ordered = [...others]
    ordered.splice(Math.min(index, others.length), 0, { id: lessonId, releaseAt: lesson.releaseAt })

    // The new section's shared date, when it has one.
    let releaseAt = lesson.releaseAt
    if (moving && others.length > 0) {
      const first = others[0].releaseAt?.getTime() ?? null
      if (others.every((l) => (l.releaseAt?.getTime() ?? null) === first)) {
        releaseAt = first === null ? null : new Date(first)
      }
    }

    const source = moving
      ? await prisma.lesson.findMany({
          where: { sectionId: lesson.sectionId, id: { not: lessonId } },
          orderBy: { order: "asc" },
          select: { id: true },
        })
      : []

    await prisma.$transaction([
      ...ordered.map((l, i) =>
        prisma.lesson.update({
          where: { id: l.id },
          data: l.id === lessonId ? { order: i + 1, sectionId: target.id, releaseAt } : { order: i + 1 },
        }),
      ),
      // Close the gap it left behind.
      ...source.map((l, i) => prisma.lesson.update({ where: { id: l.id }, data: { order: i + 1 } })),
    ])

    return NextResponse.json({ ok: true, releaseAt: releaseAt?.toISOString() ?? null })
  } catch (err) {
    console.error("[PUT /api/tutor/courses/[id]/lessons/move]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
