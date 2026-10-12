import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { isValidTimeZone, shiftReleaseAt } from "@/lib/lesson-release"

/**
 * Release a course section by section from one start date.
 *
 * Setting a release date on every lesson of a term is a lot of typing for one
 * decision: "start on the 6th, one section a week". This takes that decision
 * and writes the dates — section 1 on the start date, section 2 one step later,
 * and so on, every lesson in a section sharing its date. A course taught as
 * "Day 1, Day 2, Day 3" with three days a week opens three sections at a time
 * (`sectionsPerStep`). A single lesson can still be given its own date
 * afterwards from its edit page.
 */

type RouteContext = { params: Promise<{ id: string }> }

const DEFAULT_TIME_ZONE = "Europe/London"

// PUT /api/admin/courses/[id]/release-schedule
//   { startAt: ISO, everyDays?: number, sectionsPerStep?: number, timeZone?: string } — staged release
//   { startAt: null }                                                               — everything straight away
async function handlePUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as {
      startAt?: string | null
      everyDays?: number
      sectionsPerStep?: number
      timeZone?: string
    }

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, sections: { orderBy: { order: "asc" }, select: { id: true, title: true } } },
    })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    if (body.startAt === null) {
      const { count } = await prisma.lesson.updateMany({
        where: { section: { courseId: id } },
        data: { releaseAt: null },
      })
      return NextResponse.json({ lessons: count, sections: course.sections.map((s) => ({ ...s, releaseAt: null })) })
    }

    const start = typeof body.startAt === "string" ? new Date(body.startAt) : null
    if (!start || Number.isNaN(start.getTime())) {
      return NextResponse.json({ message: "Choose the date the first section opens" }, { status: 400 })
    }
    const everyDays = body.everyDays ?? 7
    if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 60) {
      return NextResponse.json({ message: "The gap between sections is not valid" }, { status: 400 })
    }
    const sectionsPerStep = body.sectionsPerStep ?? 1
    if (!Number.isInteger(sectionsPerStep) || sectionsPerStep < 1 || sectionsPerStep > 20) {
      return NextResponse.json({ message: "The number of sections to open at a time is not valid" }, { status: 400 })
    }
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_TIME_ZONE

    // Same time of day for every section, as the clock on the wall reads it —
    // so a weekly 09:00 stays 09:00 after the clocks change.
    const dates = course.sections.map((_, i) => {
      const step = Math.floor(i / sectionsPerStep)
      return step === 0 ? start : shiftReleaseAt(start, step * everyDays, timeZone)
    })

    const results = await prisma.$transaction(
      course.sections.map((section, i) =>
        prisma.lesson.updateMany({ where: { sectionId: section.id }, data: { releaseAt: dates[i] } }),
      ),
    )

    return NextResponse.json({
      lessons: results.reduce((n, r) => n + r.count, 0),
      sections: course.sections.map((s, i) => ({ ...s, releaseAt: dates[i].toISOString() })),
    })
  } catch (err) {
    console.error("[PUT /api/admin/courses/[id]/release-schedule]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
