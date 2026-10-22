import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseTeachScope } from "@/lib/permissions"
import { attemptsLeft } from "@/lib/quiz"

/**
 * How a course's students did on one test.
 *
 * Open to whoever looks after the course's students — its teachers, admins and
 * the support team. What each student answered, and how each question went, is
 * teaching material, so that part needs `resources.view` and support staff get
 * the scores only.
 *
 *   GET /api/tutor/lessons/[id]/results               — everyone on the course
 *   GET /api/tutor/lessons/[id]/results?studentId=…   — one student's attempts
 */
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await prisma.lesson.findFirst({
      where: { id, type: "QUIZ", section: { course: courseTeachScope(session) } },
      select: {
        id: true,
        title: true,
        section: { select: { courseId: true } },
        test: { select: { id: true, passMark: true, maxAttempts: true, _count: { select: { questions: true } } } },
      },
    })
    if (!lesson?.test) return NextResponse.json({ message: "Test not found" }, { status: 404 })
    const test = lesson.test

    const courseId = lesson.section.courseId
    const seesAnswers = can(session.role, "resources.view")

    // ── One student's attempts, newest first ────────────────────────────────
    const studentId = req.nextUrl.searchParams.get("studentId")?.trim()
    if (studentId) {
      if (!seesAnswers) return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      const enrolled = await prisma.enrollment.findFirst({ where: { courseId, studentId }, select: { id: true } })
      if (!enrolled) return NextResponse.json({ message: "Student is not on this course" }, { status: 404 })

      const attempts = await prisma.quizAttempt.findMany({
        where: { lessonId: id, userId: studentId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, score: true, passed: true, selfMarked: true, createdAt: true,
          answers: {
            select: {
              id: true, questionId: true, optionId: true, optionIds: true, answerText: true, videoUrl: true,
              marks: true, markedByTutor: true, isCorrect: true,
            },
          },
        },
      })
      return NextResponse.json({ attempts })
    }

    // ── The whole course ────────────────────────────────────────────────────
    const enrolments = await prisma.enrollment.findMany({
      where: { courseId },
      orderBy: { student: { name: "asc" } },
      select: { student: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    })
    const studentIds = enrolments.map((e) => e.student.id)

    // Only the course's current students count: a free-preview visitor or
    // someone since removed would otherwise skew the averages.
    const attempts = studentIds.length > 0
      ? await prisma.quizAttempt.findMany({
          where: { lessonId: id, userId: { in: studentIds } },
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true, score: true, passed: true, selfMarked: true, createdAt: true },
        })
      : []

    const students = enrolments.map(({ student }) => {
      const mine = attempts.filter((a) => a.userId === student.id)
      const latest = mine[mine.length - 1]
      const passed = mine.some((a) => a.passed)
      const left = attemptsLeft(test.maxAttempts, mine.length)
      return {
        ...student,
        attempts: mine.length,
        attemptsLeft: left,
        bestScore: mine.length > 0 ? Math.max(...mine.map((a) => a.score)) : null,
        latestScore: latest?.score ?? null,
        lastAttemptAt: latest?.createdAt.toISOString() ?? null,
        // Submitted, but the student has not marked their written or signed answers yet.
        awaitingMarks: mine.some((a) => !a.selfMarked),
        status: passed ? "PASSED" : mine.length === 0 ? "NOT_STARTED" : left === 0 ? "FAILED" : "IN_PROGRESS",
      }
    })

    const taken = students.filter((s) => s.bestScore !== null)
    const summary = {
      students: students.length,
      taken: taken.length,
      passed: students.filter((s) => s.status === "PASSED").length,
      // Each student counts once, by their best score.
      averageScore: taken.length > 0
        ? Math.round(taken.reduce((sum, s) => sum + (s.bestScore ?? 0), 0) / taken.length)
        : null,
      attempts: attempts.length,
    }

    // How each question went, over every attempt — shows which ones the class
    // finds hard (or which were worded badly).
    let questions: Array<{ id: string; order: number; question: string; answered: number; correct: number }> = []
    if (seesAnswers) {
      const [list, tallies] = await Promise.all([
        prisma.quizQuestion.findMany({
          where: { testId: test.id },
          orderBy: { order: "asc" },
          select: { id: true, order: true, question: true },
        }),
        attempts.length > 0
          ? prisma.quizAttemptAnswer.groupBy({
              by: ["questionId", "isCorrect"],
              where: { attemptId: { in: attempts.map((a) => a.id) } },
              _count: { _all: true },
            })
          : [],
      ])
      questions = list.map((q) => {
        const mine = tallies.filter((t) => t.questionId === q.id)
        return {
          ...q,
          answered: mine.reduce((sum, t) => sum + t._count._all, 0),
          correct: mine.filter((t) => t.isCorrect).reduce((sum, t) => sum + t._count._all, 0),
        }
      })
    }

    return NextResponse.json({
      test: {
        id: lesson.id,
        title: lesson.title,
        passMark: test.passMark,
        maxAttempts: test.maxAttempts,
        questionCount: test._count.questions,
      },
      summary,
      students,
      questions,
      seesAnswers,
    })
  } catch (err) {
    console.error("[GET /api/tutor/lessons/[id]/results]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tutor/lessons/[id]/results?studentId=… — give a student a fresh
// start on this test: their attempts are cleared, so they have every attempt
// again. For a student who ran out, or who sat it by mistake.
async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Teaching staff only — the same people who can see the answers.
    if (!can(session.role, "students.view") || !can(session.role, "resources.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const studentId = req.nextUrl.searchParams.get("studentId")?.trim()
    if (!studentId) return NextResponse.json({ message: "studentId is required" }, { status: 400 })

    const lesson = await prisma.lesson.findFirst({
      where: { id, type: "QUIZ", section: { course: courseTeachScope(session) } },
      select: { id: true, section: { select: { courseId: true } } },
    })
    if (!lesson) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const [{ count }] = await prisma.$transaction([
      prisma.quizAttempt.deleteMany({ where: { lessonId: id, userId: studentId } }),
      // Passing ticked the lesson off; with the attempts gone it is to do again.
      prisma.lessonProgress.updateMany({
        where: { lessonId: id, enrollment: { studentId, courseId: lesson.section.courseId } },
        data: { isCompleted: false, completedAt: null },
      }),
    ])

    return NextResponse.json({ message: "Attempts reset", deleted: count })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]/results]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const DELETE = withAudit(handleDELETE)
