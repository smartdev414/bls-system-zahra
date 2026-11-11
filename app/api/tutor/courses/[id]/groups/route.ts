import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope, isStaff } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { enrolStudents, usableGroups } from "@/lib/course-groups"

/**
 * The groups on a course, each with its students and its upcoming classes.
 *
 * This is what the course page is organised around: a course is one level, and
 * each group on it is one class with its own day and time.
 */

type RouteContext = { params: Promise<{ id: string }> }

async function findManagedCourse(session: { role: string; sub: string }, id: string) {
  return prisma.course.findFirst({
    where: { id, ...courseTeachScope(session) },
    select: {
      id: true,
      title: true,
      format: true,
      venue: true,
      tutorId: true,
      tutor: { select: { id: true, name: true, role: true } },
      teachers: { orderBy: { assignedAt: "asc" }, select: { tutor: { select: { id: true, name: true } } } },
    },
  })
}

// GET /api/tutor/courses/[id]/groups
async function handleGET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const staff = isStaff(session.role)

    const [links, sessions] = await Promise.all([
      prisma.courseGroup.findMany({
        where: { courseId: id },
        orderBy: { addedAt: "asc" },
        select: {
          group: {
            select: {
              id: true,
              name: true,
              tutorId: true,
              members: { select: { studentId: true } },
            },
          },
        },
      }),
      // Every class still to come on this course, whoever is taking it.
      prisma.liveSession.findMany({
        where: { courseId: id, status: { in: ["SCHEDULED", "LIVE"] } },
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          durationMins: true,
          week: true,
          status: true,
          visibility: true,
          groupId: true,
          tutorId: true,
          tutor: { select: { name: true } },
          _count: { select: { invites: true } },
        },
      }),
    ])

    const groupIds = new Set(links.map((l) => l.group.id))
    const shape = (s: (typeof sessions)[number]) => ({
      id: s.id,
      title: s.title,
      scheduledAt: s.scheduledAt.toISOString(),
      durationMins: s.durationMins,
      week: s.week,
      status: s.status,
      visibility: s.visibility,
      tutorId: s.tutorId,
      tutorName: s.tutor.name,
      inviteCount: s._count.invites,
      // Staff run the whole timetable; a tutor changes only their own classes.
      canManage: staff || s.tutorId === session.sub,
    })

    // Who can take a class: the course's own teachers, so the office picks from
    // a short, relevant list. With none set yet, fall back to every tutor.
    let tutorOptions: Array<{ id: string; name: string }> = []
    if (staff) {
      tutorOptions = [
        ...(course.tutor.role === "TUTOR" ? [{ id: course.tutor.id, name: course.tutor.name }] : []),
        ...course.teachers.map((t) => t.tutor),
      ]
      if (tutorOptions.length === 0) {
        tutorOptions = await prisma.user.findMany({
          where: { role: "TUTOR" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      }
    }

    return NextResponse.json({
      groups: links.map(({ group }) => ({
        id: group.id,
        name: group.name,
        // A group the office set up is not a teacher's to change.
        canEdit: staff || group.tutorId === session.sub,
        studentIds: group.members.map((m) => m.studentId),
        sessions: sessions.filter((s) => s.groupId === group.id).map(shape),
      })),
      // Classes for everyone on the course, or left over from a group since removed.
      courseSessions: sessions.filter((s) => !s.groupId || !groupIds.has(s.groupId)).map(shape),
      mustAssignTutor: staff,
      tutorOptions,
      // Where the course's classes happen — online, or face to face at a venue.
      format: course.format,
      venue: course.venue,
    })
  } catch (err) {
    console.error("[GET /api/tutor/courses/[id]/groups]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/tutor/courses/[id]/groups — { groupId } to add an existing group,
// or { name } to start a new, empty one on this course.
async function handlePOST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage") || !can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as { groupId?: string; name?: string }

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    let group: { id: string; name: string; members: { studentId: string }[] } | null
    if (body.groupId) {
      group = await prisma.studentGroup.findFirst({
        where: { id: body.groupId, ...usableGroups(session) },
        select: { id: true, name: true, members: { select: { studentId: true } } },
      })
      if (!group) return NextResponse.json({ message: "Group not found" }, { status: 404 })
    } else if (body.name?.trim()) {
      group = await prisma.studentGroup.create({
        data: { tutorId: session.sub, name: body.name.trim() },
        select: { id: true, name: true, members: { select: { studentId: true } } },
      })
    } else {
      return NextResponse.json({ message: "Choose a group or name a new one" }, { status: 400 })
    }

    await prisma.courseGroup.createMany({
      data: [{ courseId: id, groupId: group.id }],
      skipDuplicates: true,
    })

    // Being in a group on the course means being on the course.
    const { added, skipped } = await enrolStudents(course, group.members.map((m) => m.studentId), session)

    return NextResponse.json(
      { group: { id: group.id, name: group.name }, added: added.length, skipped },
      { status: 201 },
    )
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/groups]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tutor/courses/[id]/groups?groupId=… — take the group off the
// course. Its students stay on the course and keep their progress.
async function handleDELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const groupId = req.nextUrl.searchParams.get("groupId")?.trim()
    if (!groupId) return NextResponse.json({ message: "groupId is required" }, { status: 400 })

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const { count } = await prisma.courseGroup.deleteMany({ where: { courseId: id, groupId } })
    if (count === 0) return NextResponse.json({ message: "That group is not on this course" }, { status: 404 })

    return NextResponse.json({ message: "Group removed from the course" })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/groups]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(tutorWrite("groups", handlePOST))
export const DELETE = withAudit(tutorWrite("groups", handleDELETE))
