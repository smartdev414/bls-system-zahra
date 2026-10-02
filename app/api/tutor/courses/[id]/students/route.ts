import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope } from "@/lib/permissions"
import { createNotification, createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"
import { BEHIND_AFTER_DAYS, reminderLink } from "@/lib/homework"

/**
 * The students on one course, managed from the course page itself.
 *
 * A tutor builds a course per class (Level 1, Level 2, …) and puts that class's
 * students on it — one by one or a whole saved group at once. Adding a group is
 * a one-time copy of its members: the course keeps its own list from then on,
 * so editing the group later never enrols or unenrols anybody behind the
 * tutor's back.
 */

type RouteContext = { params: Promise<{ id: string }> }

/** The course, if this caller may manage who is on it. Tutors: the ones they teach. */
async function findManagedCourse(session: { role: string; sub: string }, id: string) {
  return prisma.course.findFirst({
    where: { id, ...courseTeachScope(session) },
    select: { id: true, title: true, tutorId: true },
  })
}

// GET /api/tutor/courses/[id]/students — who is on this course
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

    // Everything is measured against what has been released: a test that is
    // scheduled for next week is not homework yet.
    const [enrolments, lessons] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId: id },
        orderBy: { student: { name: "asc" } },
        include: {
          student: { select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true } },
          progress: { select: { lessonId: true, isCompleted: true, updatedAt: true } },
        },
      }),
      prisma.lesson.findMany({
        where: { section: { courseId: id }, ...releasedLessons() },
        select: { id: true, type: true },
      }),
    ])

    const lessonIds = new Set(lessons.map((l) => l.id))
    const testIds = lessons.filter((l) => l.type === "QUIZ").map((l) => l.id)
    const studentIds = enrolments.map((e) => e.studentId)

    const [attempts, reminders] = await Promise.all([
      testIds.length > 0 && studentIds.length > 0
        ? prisma.quizAttempt.findMany({
            where: { lessonId: { in: testIds }, userId: { in: studentIds } },
            select: { userId: true, lessonId: true, passed: true, createdAt: true },
          })
        : [],
      // The reminder history is the notifications themselves, so there is a
      // record of every nudge a student was sent for this course.
      studentIds.length > 0
        ? prisma.notification.groupBy({
            by: ["userId"],
            where: { type: "HOMEWORK_REMINDER", link: reminderLink(id), userId: { in: studentIds } },
            _max: { createdAt: true },
            _count: { _all: true },
          })
        : [],
    ])
    const remindedAt = new Map(reminders.map((r) => [r.userId, { last: r._max.createdAt, count: r._count._all }]))

    const behindBefore = Date.now() - BEHIND_AFTER_DAYS * 24 * 60 * 60 * 1000

    return NextResponse.json({
      totalLessons: lessons.length,
      totalTests: testIds.length,
      students: enrolments.map((e) => {
        const mine = attempts.filter((a) => a.userId === e.studentId)
        const completedLessons = e.progress.filter((p) => p.isCompleted && lessonIds.has(p.lessonId)).length
        const testsPassed = new Set(mine.filter((a) => a.passed).map((a) => a.lessonId)).size
        const lastActive = Math.max(
          0,
          ...e.progress.map((p) => p.updatedAt.getTime()),
          ...mine.map((a) => a.createdAt.getTime()),
        )
        const outstanding = completedLessons < lessons.length || testsPassed < testIds.length
        const reminder = remindedAt.get(e.studentId)
        return {
          ...e.student,
          enrolledAt: e.enrolledAt.toISOString(),
          completedLessons,
          testsPassed,
          lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
          // Work still to do and nothing touched for a week — or ever.
          behind: outstanding && lastActive < behindBefore,
          lastRemindedAt: reminder?.last?.toISOString() ?? null,
          reminderCount: reminder?.count ?? 0,
        }
      }),
      total: enrolments.length,
    })
  } catch (err) {
    console.error("[GET /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/tutor/courses/[id]/students — { studentIds: [...] }
async function handlePOST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds } = await req.json() as { studentIds?: string[] }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "Select at least one student" }, { status: 400 })
    }

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Only real students, and only ones not already on the course.
    const students = await prisma.user.findMany({
      where: { id: { in: [...new Set(studentIds)] }, role: "STUDENT" },
      select: { id: true },
    })
    const alreadyOn = await prisma.enrollment.findMany({
      where: { courseId: id, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    })
    const skip = new Set(alreadyOn.map((e) => e.studentId))
    const toAdd = students.map((s) => s.id).filter((sid) => !skip.has(sid))

    if (toAdd.length === 0) {
      return NextResponse.json({ added: 0, skipped: skip.size })
    }

    await prisma.enrollment.createMany({
      data: toAdd.map((studentId) => ({ studentId, courseId: id })),
      skipDuplicates: true,
    })

    void createNotifications(
      toAdd,
      "NEW_ENROLLMENT",
      "You've been added to a course",
      `${session.name} enrolled you in "${course.title}"`,
      `/student/lessons?courseId=${id}`,
    )
    // The tutor only needs telling when somebody else did it for them.
    if (course.tutorId !== session.sub) {
      void createNotification(
        course.tutorId,
        "NEW_ENROLLMENT",
        "Students added to your course",
        `${session.name} enrolled ${toAdd.length} student${toAdd.length === 1 ? "" : "s"} in "${course.title}"`,
        `/tutor/courses/${id}`,
      )
    }

    return NextResponse.json({ added: toAdd.length, skipped: skip.size }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tutor/courses/[id]/students?studentId=…
async function handleDELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const studentId = req.nextUrl.searchParams.get("studentId")?.trim()
    if (!studentId) return NextResponse.json({ message: "studentId is required" }, { status: 400 })

    const course = await findManagedCourse(session, id)
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    // Removing the enrolment cascades to the student's lesson progress.
    const { count } = await prisma.enrollment.deleteMany({ where: { courseId: id, studentId } })
    if (count === 0) return NextResponse.json({ message: "Student is not on this course" }, { status: 404 })

    return NextResponse.json({ message: "Student removed from the course" })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
