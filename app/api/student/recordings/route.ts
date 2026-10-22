import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// GET /api/student/recordings — every recording the student made in tests,
// newest first, with the course it belongs to and, once that course has ended
// for them, the day it will be deleted. Not limited to their current courses:
// a student who has left one still has a week to download from it.
async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const [answers, deletions] = await Promise.all([
      prisma.quizAttemptAnswer.findMany({
        where: { videoUrl: { not: null }, attempt: { userId: session.sub } },
        orderBy: { attempt: { createdAt: "desc" } },
        select: {
          id: true,
          videoUrl: true,
          marks: true,
          question: { select: { question: true } },
          attempt: {
            select: {
              createdAt: true,
              lesson: { select: { id: true, title: true, section: { select: { course: { select: { id: true, title: true } } } } } },
            },
          },
        },
      }),
      prisma.testVideoDeletion.findMany({ where: { userId: session.sub }, select: { courseId: true, deleteAt: true } }),
    ])

    const deleteAt = new Map(deletions.map((d) => [d.courseId, d.deleteAt.toISOString()]))
    const recordings = answers.map((a) => {
      const course = a.attempt.lesson.section.course
      return {
        id: a.id,
        videoUrl: a.videoUrl!,
        question: a.question.question,
        correct: a.marks === null ? null : a.marks > 0,
        recordedAt: a.attempt.createdAt.toISOString(),
        test: { lessonId: a.attempt.lesson.id, title: a.attempt.lesson.title },
        course: { id: course.id, title: course.title },
        deleteAt: deleteAt.get(course.id) ?? null,
      }
    })

    return NextResponse.json({ recordings })
  } catch (err) {
    console.error("[GET /api/student/recordings]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
