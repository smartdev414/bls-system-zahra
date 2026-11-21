import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { lessonEditScope } from "@/lib/tutor-access"
import { isValidTimeZone, parseReleaseAt, shiftReleaseAt, wallClockGapMinutes } from "@/lib/lesson-release"

const DEFAULT_TIME_ZONE = "Europe/London"

async function handlePATCH(
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
    // { title } renames; { releaseAt: ISO } locks the whole section until then
    // and { releaseAt: null } unlocks it — every lesson in it gets the date.
    // With { moveLater: true } the sections after it that are still locked move
    // by the same amount: a week off pushes the rest of the term back a week.
    const body = await req.json() as { title?: string; releaseAt?: string | null; moveLater?: boolean; timeZone?: string }
    const hasTitle = body.title !== undefined
    const hasRelease = body.releaseAt !== undefined
    if (hasTitle && !body.title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })
    if (!hasTitle && !hasRelease) return NextResponse.json({ message: "Nothing to change" }, { status: 400 })

    const releaseAt = hasRelease ? parseReleaseAt(body.releaseAt) : undefined
    if (hasRelease && releaseAt === undefined) {
      return NextResponse.json({ message: "The unlock date is not a valid date" }, { status: 400 })
    }

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId, course: scope },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    const updated = hasTitle
      ? await prisma.section.update({ where: { id: sectionId }, data: { title: body.title!.trim() } })
      : section
    let moved = 0
    if (hasRelease) {
      const now = new Date()
      // The section's date before this change: its earliest lesson date.
      const before = await prisma.lesson.findFirst({
        where: { sectionId, releaseAt: { not: null } },
        orderBy: { releaseAt: "asc" },
        select: { releaseAt: true },
      })
      const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_TIME_ZONE
      const gap = body.moveLater && releaseAt && before?.releaseAt
        ? wallClockGapMinutes(before.releaseAt, releaseAt, timeZone)
        : 0
      const later = gap === 0 ? [] : await prisma.lesson.findMany({
        where: {
          section: { courseId, order: { gt: section.order } },
          releaseAt: { gt: now },
        },
        select: { id: true, sectionId: true, releaseAt: true },
      })
      // Same wall-clock move for each, so 12:15 stays 12:15 across a clock change.
      await prisma.$transaction([
        prisma.lesson.updateMany({ where: { sectionId }, data: { releaseAt } }),
        ...later.map((l) =>
          prisma.lesson.update({ where: { id: l.id }, data: { releaseAt: shiftReleaseAt(l.releaseAt!, 0, timeZone, gap) } }),
        ),
      ])
      moved = new Set(later.map((l) => l.sectionId)).size
    }

    // `moved`: how many later sections were moved with it.
    return NextResponse.json({ section: updated, ok: true, moved })
  } catch (err) {
    console.error("[PATCH /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: NextRequest,
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

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId, course: scope },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    await prisma.section.delete({ where: { id: sectionId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
