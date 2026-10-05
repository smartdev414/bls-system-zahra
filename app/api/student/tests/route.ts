import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"
import { attemptsLeft } from "@/lib/quiz"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    // Every released test on the student's courses, in course order.
    const [lessons, attempts] = await Promise.all([
      prisma.lesson.findMany({
        // Tests appear on their release date, not before.
        where: {
          type: "QUIZ",
          section: { course: { enrollments: { some: { studentId: session.sub } } } },
          ...releasedLessons(),
        },
        orderBy: [{ section: { courseId: "asc" } }, { section: { order: "asc" } }, { order: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          passMark: true,
          maxAttempts: true,
          _count: { select: { questions: true } },
          section: { select: { course: { select: { id: true, title: true, tutor: { select: { name: true } } } } } },
        },
      }),
      prisma.quizAttempt.findMany({
        where: { userId: session.sub },
        select: { lessonId: true, score: true, passed: true, createdAt: true },
      }),
    ])

    const tests = lessons.map((lesson) => {
      const mine = attempts.filter((a) => a.lessonId === lesson.id)
      const passed = mine.some((a) => a.passed)
      const left = attemptsLeft(lesson.maxAttempts, mine.length)
      return {
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        courseId: lesson.section.course.id,
        courseTitle: lesson.section.course.title,
        tutorName: lesson.section.course.tutor.name,
        questionCount: lesson._count.questions,
        passMark: lesson.passMark,
        maxAttempts: lesson.maxAttempts,
        attempts: mine.length,
        attemptsLeft: left,
        bestScore: mine.length > 0 ? Math.max(...mine.map((a) => a.score)) : null,
        lastAttemptAt: mine.length > 0
          ? new Date(Math.max(...mine.map((a) => a.createdAt.getTime()))).toISOString()
          : null,
        // A test is passed by passing it — not by the lesson being ticked off.
        isCompleted: passed,
        status: passed ? "PASSED" : mine.length === 0 ? "NOT_STARTED" : left === 0 ? "FAILED" : "IN_PROGRESS",
      }
    })

    const taken = tests.filter((t) => t.bestScore !== null)
    return NextResponse.json({
      tests,
      stats: {
        totalTests: tests.length,
        passedTests: tests.filter((t) => t.isCompleted).length,
        averageScore: taken.length > 0
          ? Math.round(taken.reduce((sum, t) => sum + (t.bestScore ?? 0), 0) / taken.length)
          : null,
      },
    })
  } catch (err) {
    console.error("[GET /api/student/tests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
