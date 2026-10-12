import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseTeachScope } from "@/lib/permissions"
import { joinedClassOf } from "@/lib/session-access"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    // The courses this tutor teaches — led or assigned. (An admin opening this
    // endpoint only ever saw their own, so keep that rather than every course.)
    const taught = session.role === "ADMIN" ? { tutorId: session.sub } : courseTeachScope(session)

    // Courses with enrollment counts
    const courses = await prisma.course.findMany({
      where: taught,
      include: {
        _count: { select: { enrollments: true } },
        reviews: { select: { rating: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    // Count unique students: enrolled in any course, invited by this tutor, or
    // joined one of their classes
    const [enrolledStudentIds, invitedStudentIds, classStudentIds] = await Promise.all([
      prisma.enrollment.findMany({
        where: { course: taught },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      prisma.user.findMany({
        where: { invitedById: session.sub },
        select: { id: true },
      }),
      prisma.user.findMany({
        where: joinedClassOf(session.sub),
        select: { id: true },
      }),
    ])
    const uniqueStudentIds = new Set([
      ...enrolledStudentIds.map((e) => e.studentId),
      ...invitedStudentIds.map((s) => s.id),
      ...classStudentIds.map((s) => s.id),
    ])
    const totalStudents = uniqueStudentIds.size
    const publishedCount = courses.filter((c) => c.status === "PUBLISHED").length
    const draftCount = courses.filter((c) => c.status === "DRAFT").length

    // Upcoming sessions
    const upcomingSessions = await prisma.liveSession.findMany({
      where: {
        tutorId: session.sub,
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      include: {
        course: { select: { title: true } },
        _count: { select: { attendances: true } },
      },
    })

    // Recent enrollments (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentEnrollments = await prisma.enrollment.findMany({
      where: {
        course: taught,
        enrolledAt: { gte: thirtyDaysAgo },
      },
      include: {
        student: { select: { id: true, name: true, email: true, avatarUrl: true } },
        course: { select: { id: true, title: true } },
        progress: true,
      },
      orderBy: { enrolledAt: "desc" },
      take: 5,
    })

    // Average completion across all enrollments
    const allEnrollments = await prisma.enrollment.findMany({
      where: { course: taught },
      include: { progress: true, course: { include: { sections: { include: { lessons: true } } } } },
    })

    let totalCompletionPct = 0
    let enrollmentCountWithLessons = 0
    for (const enrollment of allEnrollments) {
      const totalLessons = enrollment.course.sections.reduce((sum, s) => sum + s.lessons.length, 0)
      if (totalLessons === 0) continue
      const completed = enrollment.progress.filter((p) => p.isCompleted).length
      totalCompletionPct += (completed / totalLessons) * 100
      enrollmentCountWithLessons++
    }
    const avgCompletion = enrollmentCountWithLessons > 0
      ? Math.round(totalCompletionPct / enrollmentCountWithLessons)
      : 0

    // Pre-fetch lesson counts for recent enrollments
    const recentWithProgress = await Promise.all(
      recentEnrollments.map(async (enrollment) => {
        const totalLessons = await prisma.lesson.count({
          where: { section: { courseId: enrollment.courseId } },
        })
        const completedLessons = enrollment.progress.filter((p) => p.isCompleted).length
        const daysSinceEnrolled = Math.floor(
          (Date.now() - enrollment.enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
        )
        return {
          studentId: enrollment.student.id,
          studentName: enrollment.student.name,
          courseTitle: enrollment.course.title,
          courseId: enrollment.course.id,
          progress: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
          daysSinceEnrolled,
        }
      })
    )

    return NextResponse.json({
      tutorName: session.name,
      stats: {
        totalStudents,
        publishedCourses: publishedCount,
        draftCourses: draftCount,
        upcomingSessionCount: upcomingSessions.length,
        avgCompletion,
      },
      courses: courses.slice(0, 4).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        enrollmentCount: c._count.enrollments,
        rating: c.reviews.length > 0
          ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
          : null,
      })),
      upcomingSessions: upcomingSessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        durationMins: s.durationMins,
        status: s.status,
        attendeeCount: s._count.attendances,
        maxStudents: s.maxStudents,
        courseTitle: s.course?.title ?? null,
      })),
      recentStudents: recentWithProgress,
    })
  } catch (err) {
    console.error("[GET /api/tutor/dashboard]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
