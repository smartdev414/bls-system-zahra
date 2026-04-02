import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET() {
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
            course: { include: { sections: { include: { lessons: true } } } },
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
      ? Math.floor(
          (Date.now() - firstEnrollment.enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
        ) + 1
      : 1

    // Upcoming live sessions (next 7 days)
    const upcomingSessions = await prisma.liveSession.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      take: 3,
      include: { tutor: { select: { name: true } } },
    })

    return NextResponse.json({
      student: {
        name: user.name,
        bslLevel: user.bslLevel,
      },
      stats: {
        currentDay,
        completion: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        testsPassed: passedQuizzes,
        totalTests: totalQuizzes,
      },
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
