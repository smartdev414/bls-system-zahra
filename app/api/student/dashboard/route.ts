import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { studentVisibleSessions } from "@/lib/session-access"
import { isReleased } from "@/lib/lesson-release"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }
    if (session.role !== "STUDENT") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      include: {
        enrollments: {
          include: {
            course: {
              include: {
                tutor: { select: { name: true } },
                sections: {
                  orderBy: { order: "asc" },
                  // Every lesson counts towards the total; a locked one just
                  // cannot be the next to open.
                  include: { lessons: { orderBy: { order: "asc" } } },
                },
              },
            },
            progress: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }

    // Compute stats across all enrollments
    let totalLessons = 0
    let completedLessons = 0
    let totalQuizzes = 0
    let passedQuizzes = 0

    for (const enrollment of user.enrollments) {
      for (const section of enrollment.course.sections) {
        for (const lesson of section.lessons) {
          totalLessons++
          if (lesson.type === "QUIZ") totalQuizzes++
          const prog = enrollment.progress.find((p) => p.lessonId === lesson.id)
          if (prog?.isCompleted) {
            completedLessons++
            if (lesson.type === "QUIZ") passedQuizzes++
          }
        }
      }
    }

    const firstEnrollment = user.enrollments.sort(
      (a, b) => a.enrolledAt.getTime() - b.enrolledAt.getTime()
    )[0]
    const currentDay = firstEnrollment
      ? Math.floor((Date.now() - firstEnrollment.enrolledAt.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : 1

    // ── Current course: enrollment with the most recent progress activity ──
    let currentCourse: {
      courseId: string
      courseTitle: string
      thumbnailUrl: string | null
      tutorName: string
      completion: number
      completedLessons: number
      totalLessons: number
      nextLesson: { id: string; title: string; type: string } | null
    } | null = null

    if (user.enrollments.length > 0) {
      // Pick the enrollment with the latest progress update, falling back to most recently enrolled
      const active = user.enrollments.slice().sort((a, b) => {
        const aLatest = a.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), 0)
        const bLatest = b.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), 0)
        if (aLatest !== bLatest) return bLatest - aLatest
        return b.enrolledAt.getTime() - a.enrolledAt.getTime()
      })[0]

      const allLessons = active.course.sections.flatMap((s) => s.lessons)
      const enrollTotal = allLessons.length
      const enrollCompleted = active.progress.filter((p) => p.isCompleted).length
      const completedIds = new Set(active.progress.filter((p) => p.isCompleted).map((p) => p.lessonId))
      const nextLesson = allLessons.find((l) => !completedIds.has(l.id) && isReleased(l)) ?? null

      currentCourse = {
        courseId: active.course.id,
        courseTitle: active.course.title,
        thumbnailUrl: active.course.thumbnailUrl,
        tutorName: active.course.tutor.name,
        completion: enrollTotal > 0 ? Math.round((enrollCompleted / enrollTotal) * 100) : 0,
        completedLessons: enrollCompleted,
        totalLessons: enrollTotal,
        nextLesson: nextLesson
          ? { id: nextLesson.id, title: nextLesson.title, type: nextLesson.type }
          : null,
      }
    }

    // Upcoming live sessions — include LIVE ones (even if scheduledAt is past) + future SCHEDULED
    const upcomingSessions = await prisma.liveSession.findMany({
      where: {
        AND: [
          {
            OR: [
              { status: "LIVE" },
              { status: "SCHEDULED", scheduledAt: { gte: new Date() } },
            ],
          },
          studentVisibleSessions(session.sub),
        ],
      },
      orderBy: [{ status: "desc" }, { scheduledAt: "asc" }],
      take: 4,
      include: { tutor: { select: { name: true } } },
    })

    return NextResponse.json({
      student: { name: user.name, bslLevel: user.bslLevel },
      stats: {
        currentDay,
        completion: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        testsPassed: passedQuizzes,
        totalTests: totalQuizzes,
      },
      currentCourse,
      upcomingSessions: upcomingSessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        tutorName: s.tutor.name,
        status: s.status,
      })),
    })
  } catch (err) {
    console.error("[GET /api/student/dashboard]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
