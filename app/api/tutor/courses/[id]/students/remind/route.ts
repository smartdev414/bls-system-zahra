import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope } from "@/lib/permissions"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { behindClassBody, behindClassTitle, REMINDER_COOLDOWN_HOURS, reminderLink } from "@/lib/homework"
import { courseRoster } from "@/lib/course-roster"
import { isCourseClosed } from "@/lib/course-closing"

/**
 * Remind students to catch up on a course's lessons and tests.
 *
 * One click for the office or the teacher instead of chasing each student by
 * hand. Each reminder is an ordinary notification (bell + email), which is also
 * the record that it was sent — the student list shows when and how often.
 */

// POST /api/tutor/courses/[id]/students/remind — { studentIds: [...], message? }
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "enrolments.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds, message } = await req.json() as { studentIds?: string[]; message?: string }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "Select at least one student" }, { status: 400 })
    }

    const course = await prisma.course.findFirst({
      where: { id, ...courseTeachScope(session) },
      select: { id: true, title: true, closesAt: true },
    })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })
    if (isCourseClosed(course)) {
      return NextResponse.json({ message: "This course has finished, so its students can't be reminded about it." }, { status: 409 })
    }

    // Only students who are actually on the course.
    const enrolled = await prisma.enrollment.findMany({
      where: { courseId: id, studentId: { in: [...new Set(studentIds)] } },
      select: { studentId: true },
    })
    const onCourse = enrolled.map((e) => e.studentId)

    // Two people pressing the button the same day should not mean two emails.
    const link = reminderLink(id)
    const recent = await prisma.notification.findMany({
      where: {
        type: "HOMEWORK_REMINDER",
        link,
        userId: { in: onCourse },
        createdAt: { gte: new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000) },
      },
      select: { userId: true },
    })
    const alreadyReminded = new Set(recent.map((n) => n.userId))
    const toRemind = onCourse.filter((sid) => !alreadyReminded.has(sid))

    if (toRemind.length === 0) {
      return NextResponse.json({ sent: 0, skipped: alreadyReminded.size })
    }

    // Someone well behind the rest of their class hears it in those words —
    // kindly. Everyone else gets the plain catch-up reminder.
    const roster = await courseRoster(id)
    const behindClass = new Set(roster.students.filter((s) => s.behindClass).map((s) => s.id))
    const note = message?.trim().slice(0, 300)
    const extra = note ? ` ${note}` : ""
    const [encouraged, reminded] = await Promise.all([
      createNotifications(
        toRemind.filter((sid) => behindClass.has(sid)),
        "HOMEWORK_REMINDER",
        behindClassTitle(course.title),
        behindClassBody(course.title, session.name) + extra,
        link,
      ),
      createNotifications(
        toRemind.filter((sid) => !behindClass.has(sid)),
        "HOMEWORK_REMINDER",
        `Reminder: catch up on "${course.title}"`,
        `${session.name} is reminding you to catch up on your lessons and tests for "${course.title}".` + extra,
        link,
      ),
    ])
    if (!encouraged || !reminded) {
      return NextResponse.json({ message: "The reminder could not be sent. Please try again." }, { status: 502 })
    }

    // Anyone still behind sees the "you're falling behind" notice again next
    // time they open the platform, however recently they last closed it
    // (lib/student-standing.ts).
    await prisma.enrollment.updateMany({
      where: { courseId: id, studentId: { in: toRemind } },
      data: { behindNoticeSeenAt: null },
    })

    return NextResponse.json({ sent: toRemind.length, skipped: alreadyReminded.size }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/courses/[id]/students/remind]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
