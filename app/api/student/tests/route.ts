import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { READY_QUESTION } from "@/lib/tests"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"
import { attemptsLeft } from "@/lib/quiz"
import { openCourses } from "@/lib/course-closing"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    // Every released test on the student's courses, in course order.
    const [lessons, attempts, reflections] = await Promise.all([
      prisma.lesson.findMany({
        // Tests appear on their release date, not before.
        where: {
          type: "QUIZ",
          // Tests on archived or unpublished courses drop out, as on the dashboard.
          section: { course: { status: "PUBLISHED", enrollments: { some: { studentId: session.sub } }, ...openCourses() } },
          ...releasedLessons(),
        },
        orderBy: [{ section: { courseId: "asc" } }, { section: { order: "asc" } }, { order: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          test: {
            select: {
              testKind: true, vocabularyMode: true, passMark: true, maxAttempts: true, answerSeconds: true,
              _count: { select: { questions: { where: READY_QUESTION } } },
            },
          },
          section: { select: { title: true, course: { select: { id: true, title: true, tutor: { select: { name: true } } } } } },
        },
      }),
      prisma.quizAttempt.findMany({
        where: { userId: session.sub },
        select: { lessonId: true, score: true, passed: true, selfMarked: true, createdAt: true },
      }),
      // Self-reflections are written and sent back and forth, not attempted.
      prisma.reflectionSubmission.findMany({
        where: { userId: session.sub },
        select: { lessonId: true, status: true, updatedAt: true },
      }),
    ])
    const reflectionOf = new Map(reflections.map((r) => [r.lessonId, r]))

    const tests = lessons.flatMap(({ test, ...lesson }) => {
      if (!test) return []
      const mine = attempts.filter((a) => a.lessonId === lesson.id)
      // An attempt still waiting for marks has no real score yet (it is stored as 0).
      const marked = mine.filter((a) => a.selfMarked)
      const passed = mine.some((a) => a.passed)
      const left = attemptsLeft(test.maxAttempts, mine.length)
      return [{
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        courseId: lesson.section.course.id,
        courseTitle: lesson.section.course.title,
        sectionTitle: lesson.section.title,
        tutorName: lesson.section.course.tutor.name,
        kind: test.testKind,
        vocabularyMode: test.vocabularyMode,
        answerSeconds: test.answerSeconds,
        questionCount: test._count.questions,
        passMark: test.passMark,
        maxAttempts: test.maxAttempts,
        attempts: mine.length,
        attemptsLeft: left,
        bestScore: marked.length > 0 ? Math.max(...marked.map((a) => a.score)) : null,
        lastAttemptAt: mine.length > 0
          ? new Date(Math.max(...mine.map((a) => a.createdAt.getTime()))).toISOString()
          : null,
        // A test is passed by passing it — not by the lesson being ticked off.
        isCompleted: passed,
        status: passed ? "PASSED" : mine.length === 0 ? "NOT_STARTED" : left === 0 ? "FAILED" : "IN_PROGRESS",
        reflectionStatus: null as string | null,
        // A self-reflection is written and sent back and forth, not attempted.
        ...(test.testKind === "REFLECTION" && (() => {
          const r = reflectionOf.get(lesson.id)
          const complete = passed || r?.status === "COMPLETE"
          return {
            answerSeconds: null, maxAttempts: null, attempts: 0, attemptsLeft: null, bestScore: null,
            lastAttemptAt: r?.updatedAt.toISOString() ?? null,
            isCompleted: complete,
            status: complete ? "PASSED" : r ? "IN_PROGRESS" : "NOT_STARTED",
            // DRAFT, SUBMITTED, RETURNED or COMPLETE; null = not started.
            reflectionStatus: complete ? "COMPLETE" : r?.status ?? null,
          }
        })()),
      }]
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
