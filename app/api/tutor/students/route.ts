import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, courseTeachScope, isStaff } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"
import { joinedClassOf } from "@/lib/session-access"
import { learningSummary, type LearningCounts } from "@/lib/student-activity"
import { engagementOf, isOnline, latest, type Engagement } from "@/lib/engagement"
import { activity, courseTests, statusOf, testStatuses, UNFINISHED, type TestStatus } from "@/lib/test-progress"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""

    const nameEmailFilter = q
      ? { OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ] }
      : {}

    // 1. All enrollments in the courses this tutor teaches
    const enrollments = await prisma.enrollment.findMany({
      where: {
        course: courseTeachScope(session),
        ...(q ? { student: nameEmailFilter } : {}),
      },
      include: {
        student: {
          select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
        },
        course: { select: { id: true, title: true } },
        progress: true,
      },
      orderBy: { enrolledAt: "desc" },
    })

    // 2. Students invited by this tutor (accepted the invite — invitedById is set).
    //    Staff see everyone who came in through an invite, not just their own.
    const invitedStudents = await prisma.user.findMany({
      where: {
        ...(isStaff(session.role)
          ? { role: "STUDENT" as const, invitedById: { not: null } }
          : { invitedById: session.sub }),
        ...nameEmailFilter,
      },
      select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
    })
    const invitedStudentIds = new Set(invitedStudents.map((s) => s.id))

    // 3. Students who joined one of this tutor's classes, whatever the class
    //    was (public or invite-only, with or without a course).
    const classStudents = await prisma.user.findMany({
      where: {
        ...(isStaff(session.role)
          ? { role: "STUDENT" as const, attendances: { some: { joinedAt: { not: null } } } }
          : joinedClassOf(session.sub)),
        ...nameEmailFilter,
      },
      select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
    })

    // Pre-fetch lesson counts per course
    const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
    const courseLessonCounts = await Promise.all(
      courseIds.map(async (courseId) => {
        // Completion is measured against what has been released so far.
        const count = await prisma.lesson.count({ where: { section: { courseId }, ...releasedLessons() } })
        return { courseId, count }
      })
    )
    const lessonCountMap = new Map(courseLessonCounts.map((c) => [c.courseId, c.count]))

    // Build map from enrollments
    const studentMap = new Map<string, {
      id: string
      name: string
      email: string
      avatarUrl: string | null
      bslLevel: string | null
      joinedAt: string
      source: "enrolled" | "invited" | "both"
      lastSeenAt: string | null
      activeDates: string[]
      lastLoginAt: string | null
      lastStudiedAt: string | null
      studyDates: string[]
      learning30d: LearningCounts | null
      engagement: Engagement
      online: boolean
      lastRemindedAt: string | null
      testsDone: number
      testsUnfinished: number
      courses: Array<{
        id: string
        title: string
        enrolledAt: string
        totalLessons: number
        completedLessons: number
        completion: number
        tests: Array<{ id: string; title: string; status: TestStatus; score: number | null; attempts: number }>
      }>
    }>()

    // Every released test on these courses, and how each student is doing on them.
    const testsByCourse = await courseTests(courseIds)
    const allTestIds = [...testsByCourse.values()].flat().map((t) => t.id)
    const statuses = await testStatuses(allTestIds, [...new Set(enrollments.map((e) => e.studentId))])
    const blank = {
      lastSeenAt: null, activeDates: [], lastRemindedAt: null, testsDone: 0, testsUnfinished: 0,
      lastLoginAt: null, lastStudiedAt: null, studyDates: [], learning30d: null,
      engagement: "never" as Engagement, online: false,
    }

    for (const enrollment of enrollments) {
      const sid = enrollment.student.id
      const totalLessons = lessonCountMap.get(enrollment.courseId) ?? 0
      const completedLessons = enrollment.progress.filter((p) => p.isCompleted).length
      const completion = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0

      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          id: sid,
          name: enrollment.student.name,
          email: enrollment.student.email,
          avatarUrl: enrollment.student.avatarUrl,
          bslLevel: enrollment.student.bslLevel,
          joinedAt: enrollment.student.createdAt.toISOString(),
          source: invitedStudentIds.has(sid) ? "both" : "enrolled",
          ...blank,
          courses: [],
        })
      }

      const entry = studentMap.get(sid)!
      const tests = (testsByCourse.get(enrollment.courseId) ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        ...statusOf(statuses, sid, t.id),
      }))
      const unfinished = tests.filter((t) => UNFINISHED.has(t.status)).length
      entry.testsUnfinished += unfinished
      entry.testsDone += tests.length - unfinished
      entry.courses.push({
        id: enrollment.course.id,
        title: enrollment.course.title,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        totalLessons,
        completedLessons,
        completion,
        tests,
      })
    }

    // Merge invited students who are not yet enrolled in any course
    for (const student of invitedStudents) {
      if (!studentMap.has(student.id)) {
        studentMap.set(student.id, {
          id: student.id,
          name: student.name,
          email: student.email,
          avatarUrl: student.avatarUrl,
          bslLevel: student.bslLevel,
          joinedAt: student.createdAt.toISOString(),
          source: "invited",
          ...blank,
          courses: [],
        })
      } else {
        // Already in map from enrollment — upgrade source
        studentMap.get(student.id)!.source = "both"
      }
    }

    // Merge students known only from a class they joined
    for (const student of classStudents) {
      if (studentMap.has(student.id)) continue
      studentMap.set(student.id, {
        id: student.id,
        name: student.name,
        email: student.email,
        avatarUrl: student.avatarUrl,
        bslLevel: student.bslLevel,
        joinedAt: student.createdAt.toISOString(),
        source: "enrolled",
        ...blank,
        courses: [],
      })
    }

    const students = [...studentMap.values()]
    // When each was last on the platform and last reminded to catch up.
    const ids = students.map((s) => s.id)
    const [seen, learning, stamps, reminders] = await Promise.all([
      activity(ids),
      learningSummary(ids),
      ids.length > 0
        ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, lastLoginAt: true, lastActiveAt: true } })
        : [],
      ids.length > 0
        ? prisma.notification.groupBy({
            by: ["userId"],
            where: { type: "HOMEWORK_REMINDER", userId: { in: ids } },
            _max: { createdAt: true },
          })
        : [],
    ])
    const remindedAt = new Map(reminders.map((r) => [r.userId, r._max.createdAt]))
    const stampOf = new Map(stamps.map((u) => [u.id, u]))
    for (const s of students) {
      const a = seen.get(s.id)
      const l = learning.get(s.id)
      const u = stampOf.get(s.id)
      // Page loads (lastActiveAt) and API calls (ApiLog) both count as being seen.
      const lastSeen = latest(a?.lastSeenAt, u?.lastActiveAt, u?.lastLoginAt, l?.lastStudiedAt)
      s.lastSeenAt = lastSeen?.toISOString() ?? null
      // A day they studied is a day they were on, even if no page load was logged.
      s.activeDates = [...new Set([...(a?.activeDates ?? []), ...(l?.studyDates ?? [])])].sort().reverse()
      s.lastLoginAt = u?.lastLoginAt?.toISOString() ?? null
      s.lastStudiedAt = l?.lastStudiedAt?.toISOString() ?? null
      s.studyDates = l?.studyDates ?? []
      s.learning30d = l?.counts ?? null
      s.engagement = engagementOf({ lastSeenAt: lastSeen, lastStudiedAt: l?.lastStudiedAt })
      s.online = isOnline(u?.lastActiveAt)
      s.lastRemindedAt = remindedAt.get(s.id)?.toISOString() ?? null
    }
    return NextResponse.json({ students, total: students.length })
  } catch (err) {
    console.error("[GET /api/tutor/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
