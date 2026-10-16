import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { uniqueCourseSlug } from "@/lib/course-slug"
import { isValidTimeZone, shiftReleaseAt } from "@/lib/lesson-release"
import { enrolStudents, usableGroups } from "@/lib/course-groups"

/**
 * Copy a course for another group.
 *
 * Two groups that start in different months cannot share one course, because a
 * lesson has one release date. So the school builds a course once, checks it,
 * and copies it: the copy has the same sections, lessons, files and tests, with
 * every release date moved by the gap between the two start dates.
 *
 * What is NOT copied is everything about the people: students, groups, classes,
 * teachers, progress and reviews. Files are not duplicated either — the copy's
 * lessons point at the same stored files. The group the copy is for can be put
 * on it in the same step.
 */

type RouteContext = { params: Promise<{ id: string }> }

/** The school's clocks, when the browser did not say which zone it is in. */
const DEFAULT_TIME_ZONE = "Europe/London"

/** A copy can be moved by up to ten years either way — anything more is a typo. */
const MAX_SHIFT_DAYS = 3660

async function loadCourse(id: string) {
  return prisma.course.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: {
              assets: { orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  })
}

/** Copying brings the lesson content with it, so it is for those who build content. */
function mayCopy(role: string) {
  return can(role, "courses.create") && can(role, "lessons.manage")
}

// GET /api/admin/courses/[id]/copy — what a copy would contain
async function handleGET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!mayCopy(session.role)) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const course = await loadCourse(id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const lessons = course.sections.flatMap((s) => s.lessons)
    const releases = lessons.flatMap((l) => (l.releaseAt ? [l.releaseAt.getTime()] : []))

    return NextResponse.json({
      title: course.title,
      sections: course.sections.length,
      lessons: lessons.filter((l) => l.type !== "QUIZ").length,
      tests: lessons.filter((l) => l.type === "QUIZ").length,
      files: lessons.reduce((n, l) => n + l.assets.length, 0),
      // Lessons and tests with a release date — the ones a new start date moves.
      scheduled: releases.length,
      firstReleaseAt: releases.length > 0 ? new Date(Math.min(...releases)).toISOString() : null,
      lastReleaseAt: releases.length > 0 ? new Date(Math.max(...releases)).toISOString() : null,
    })
  } catch (err) {
    console.error("[GET /api/admin/courses/[id]/copy]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/admin/courses/[id]/copy — { title, shiftDays?, timeZone? }
async function handlePOST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!mayCopy(session.role)) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await req.json() as {
      title?: string
      shiftDays?: number
      timeZone?: string
      /** Put this group on the copy straight away, enrolling its students. */
      groupId?: string
    }

    const title = body.title?.trim()
    if (!title) return NextResponse.json({ message: "Give the copy a name" }, { status: 400 })

    const shiftDays = body.shiftDays ?? 0
    if (!Number.isInteger(shiftDays) || Math.abs(shiftDays) > MAX_SHIFT_DAYS) {
      return NextResponse.json({ message: "The new start date is not valid" }, { status: 400 })
    }
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_TIME_ZONE

    const source = await loadCourse(id)
    if (!source) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Checked before anything is created, so a bad group does not leave a copy behind.
    const group = body.groupId
      ? await prisma.studentGroup.findFirst({
          where: { id: body.groupId, ...usableGroups(session) },
          select: { id: true, name: true, members: { select: { studentId: true } } },
        })
      : null
    if (body.groupId && !group) return NextResponse.json({ message: "Group not found" }, { status: 404 })

    const move = (releaseAt: Date | null) =>
      releaseAt && shiftDays !== 0 ? shiftReleaseAt(releaseAt, shiftDays, timeZone) : releaseAt

    // One nested create, so the copy either arrives whole or not at all.
    const copy = await prisma.course.create({
      data: {
        // The person copying leads the copy; its teachers are chosen afresh,
        // since another group usually means another teacher.
        tutorId: session.sub,
        categoryId: source.categoryId,
        title,
        slug: await uniqueCourseSlug(title),
        description: source.description,
        thumbnailUrl: source.thumbnailUrl,
        level: source.level,
        // Always a draft: it is published once its dates and group are right.
        status: "DRAFT",
        sections: {
          create: source.sections.map((section) => ({
            title: section.title,
            order: section.order,
            lessons: {
              create: section.lessons.map((lesson) => ({
                title: lesson.title,
                type: lesson.type,
                description: lesson.description,
                order: lesson.order,
                isFree: lesson.isFree,
                releaseAt: move(lesson.releaseAt),
                // A test is the same bank test in the copy: changing it changes both.
                testId: lesson.testId,
                assets: {
                  create: lesson.assets.map((a) => ({
                    type: a.type,
                    title: a.title,
                    description: a.description,
                    fileUrl: a.fileUrl,
                    fileName: a.fileName,
                    fileSize: a.fileSize,
                    duration: a.duration,
                    mimeType: a.mimeType,
                    order: a.order,
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true, title: true, tutorId: true },
    })

    // The copy is usually made for a particular group — put it on in the same step.
    let enrolled = 0
    if (group) {
      await prisma.courseGroup.createMany({ data: [{ courseId: copy.id, groupId: group.id }], skipDuplicates: true })
      enrolled = (await enrolStudents(copy, group.members.map((m) => m.studentId), session)).added.length
    }

    const lessons = source.sections.flatMap((s) => s.lessons)
    return NextResponse.json(
      {
        course: { id: copy.id, title: copy.title },
        group: group ? { id: group.id, name: group.name, enrolled } : null,
        copied: {
          sections: source.sections.length,
          lessons: lessons.length,
          files: lessons.reduce((n, l) => n + l.assets.length, 0),
          datesMoved: shiftDays !== 0 ? lessons.filter((l) => l.releaseAt).length : 0,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error("[POST /api/admin/courses/[id]/copy]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
