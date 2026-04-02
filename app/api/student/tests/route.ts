import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    // Find all quiz lessons in enrolled courses
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: session.sub },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            tutor: { select: { name: true } },
            sections: {
              include: {
                lessons: {
                  where: { type: "QUIZ" },
                  orderBy: { order: "asc" },
                  include: { assets: { orderBy: { order: "asc" } } },
                },
              },
            },
          },
        },
        progress: { where: { lesson: { type: "QUIZ" } } },
      },
    })

    const tests = enrollments.flatMap((enrollment) =>
      enrollment.course.sections.flatMap((section) =>
        enrollment.course.sections
          .flatMap((s) => s.lessons)
          .filter((l) => l.type === "QUIZ")
          .map((lesson) => {
            const prog = enrollment.progress.find((p) => p.lessonId === lesson.id)
            return {
              id: lesson.id,
              title: lesson.title,
              description: lesson.description,
              courseTitle: enrollment.course.title,
              tutorName: enrollment.course.tutor.name,
              isCompleted: prog?.isCompleted ?? false,
              enrollmentId: enrollment.id,
            }
          })
      )
    )

    // Deduplicate by lesson id
    const seen = new Set<string>()
    const uniqueTests = tests.filter((t) => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })

    const totalTests = uniqueTests.length
    const passedTests = uniqueTests.filter((t) => t.isCompleted).length

    return NextResponse.json({
      tests: uniqueTests,
      stats: { totalTests, passedTests },
    })
  } catch (err) {
    console.error("[GET /api/student/tests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
